"use client";

import { useEffect, useRef, useState } from "react";
import { type Address, getAbiItem, type Log } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { clearRestoredEnvelopes, loadRestoredEnvelopes } from "./chainExport";
import {
  loadRegisterEnvelope,
  loadSettingsEnvelope,
  upsertLocalChain,
} from "./chainsLocal";
import { CHAINPOOL_ABI, CHAINPOOL_ADDRESS, IS_CONTRACT_CONFIGURED } from "./contract";
import { loadEphKey } from "./ephemeral";
import { getChunkedLogs } from "./logs";
import { replay, type OnchainEvent, type ReplayResult, type ViewerCtx } from "./state";
import { createWakuClient, type ChainEnvelope, type WakuClient } from "./waku";

/** Stable identity for an envelope, used to dedupe local + echo + store paths. */
function envelopeKey(env: ChainEnvelope): string {
  const body = (env.body ?? {}) as Record<string, unknown>;
  if (env.type === "chat") {
    return `chat:${String(body.ephAddr)}:${String(body.nonce)}`;
  }
  if (env.type === "transfer") {
    return `transfer:${String(body.from)}:${String(body.nonce)}`;
  }
  if (env.type === "register") {
    return `register:${String(body.wallet)}:${String(body.ephAddr)}`;
  }
  if (env.type === "poll") {
    return `poll:${String(body.pollId)}`;
  }
  if (env.type === "vote") {
    // Same voter may re-vote with a new nonce; dedupe per (poll, voter, nonce)
    return `vote:${String(body.pollId)}:${String(body.ephAddr)}:${String(body.nonce)}`;
  }
  if (env.type === "settings") {
    return `settings:${String(body.creator)}:${String(body.nonce)}`;
  }
  return `${env.type}:${env.ts}`;
}

const depositedEvent = getAbiItem({ abi: CHAINPOOL_ABI, name: "Deposited" });
const withdrawnEvent = getAbiItem({ abi: CHAINPOOL_ABI, name: "Withdrawn" });
const transferAppliedEvent = getAbiItem({
  abi: CHAINPOOL_ABI,
  name: "TransferApplied",
});

function logToOnchainEvent(log: Log, kind: "Deposited" | "Withdrawn" | "TransferApplied"): OnchainEvent | null {
  const blockNumber = log.blockNumber ?? 0n;
  const logIndex = log.logIndex ?? 0;
  if (kind === "Deposited") {
    const args = (log as unknown as { args: { from: Address; amount: bigint } }).args;
    return {
      kind,
      blockNumber,
      logIndex,
      data: { kind, from: args.from, amount: args.amount },
    };
  }
  if (kind === "Withdrawn") {
    const args = (log as unknown as { args: { to: Address; amount: bigint } }).args;
    return {
      kind,
      blockNumber,
      logIndex,
      data: { kind, to: args.to, amount: args.amount },
    };
  }
  const args = (log as unknown as {
    args: { from: Address; to: Address; amount: bigint; nonce: bigint };
  }).args;
  return {
    kind,
    blockNumber,
    logIndex,
    data: {
      kind,
      from: args.from,
      to: args.to,
      amount: args.amount,
      nonce: args.nonce,
    },
  };
}

export interface ChainMeta {
  seedCommit: `0x${string}`;
  creator: Address;
  closed: boolean;
  expiresAt: bigint; // 0 = no expiry
  isActive: boolean;
}

export interface UseChainStateResult {
  state: ReplayResult | null;
  waku: WakuClient | null;
  meta: ChainMeta | null;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
  /** Append an envelope to the local replay buffer (e.g. a message we just published). */
  addLocalEnvelope: (env: ChainEnvelope) => void;
  /** Live snapshot of the raw Waku envelope buffer (for export). */
  getRawEnvelopes: () => ChainEnvelope[];
  /** Live snapshot of the cached on-chain events (for export). */
  getOnchainEvents: () => OnchainEvent[];
}

export function useChainState(chainIdStr: string | null): UseChainStateResult {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [state, setState] = useState<ReplayResult | null>(null);
  const [waku, setWaku] = useState<WakuClient | null>(null);
  const [meta, setMeta] = useState<ChainMeta | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const onchainRef = useRef<OnchainEvent[]>([]);
  const wakuRef = useRef<ChainEnvelope[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const viewerRef = useRef<ViewerCtx | null>(null);
  const creatorRef = useRef<Address | null>(null);
  const recomputeRef = useRef<() => void>(() => {});
  const onchainScannedToRef = useRef<bigint | null>(null);
  const onchainLoadingRef = useRef(false);

  // Keep viewer ctx in sync with the connected wallet's chat eph key for this
  // chain. Used by replay() to decrypt 1:1 DMs locally.
  useEffect(() => {
    if (!chainIdStr || !address) {
      viewerRef.current = null;
      return;
    }
    const eph = loadEphKey(BigInt(chainIdStr), address);
    viewerRef.current = eph
      ? { wallet: address, ephPriv: eph.privHex }
      : null;
    recomputeRef.current?.();
  }, [chainIdStr, address]);

  // Helper used by both the Waku subscribe/history callbacks and the local
  // optimistic inserter. Returns true if the envelope was newly added.
  const ingest = (env: ChainEnvelope): boolean => {
    const k = envelopeKey(env);
    if (seenRef.current.has(k)) return false;
    seenRef.current.add(k);
    wakuRef.current.push(env);
    return true;
  };

  useEffect(() => {
    if (!chainIdStr || !publicClient) return;
    const chainId = BigInt(chainIdStr);
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let republishTimer: ReturnType<typeof setInterval> | null = null;
    let republishCount = 0;
    onchainRef.current = [];
    onchainScannedToRef.current = null;
    onchainLoadingRef.current = false;
    wakuRef.current = [];
    seenRef.current = new Set();

    async function recompute() {
      if (cancelled) return;
      try {
        const result = await replay(
          chainId,
          onchainRef.current,
          wakuRef.current,
          viewerRef.current,
          creatorRef.current,
        );
        if (!cancelled) {
          setState(result);
          // Mirror replayed settings into the local chain cache so the home
          // page can render names/descriptions/discoverable flags without
          // re-fetching Waku.
          if (chainIdStr) {
            const entry: { id: string; description?: string; discoverable?: boolean } = {
              id: chainIdStr,
            };
            if (result.settings.description !== undefined) {
              entry.description = result.settings.description;
            }
            if (result.settings.discoverable !== undefined) {
              entry.discoverable = result.settings.discoverable;
            }
            if (entry.description !== undefined || entry.discoverable !== undefined) {
              upsertLocalChain(entry);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    recomputeRef.current = () => void recompute();

    async function loadOnchain() {
      if (!publicClient) return;
      if (!IS_CONTRACT_CONFIGURED) return;
      if (onchainLoadingRef.current) return;
      onchainLoadingRef.current = true;
      try {
        const head = await publicClient.getBlockNumber();
        const scannedTo = onchainScannedToRef.current;
        const fromBlock =
          scannedTo === null ? undefined : scannedTo >= head ? head + 1n : scannedTo + 1n;
        if (fromBlock !== undefined && fromBlock > head) return;

        const scanOptions = {
          fromBlock,
          toBlock: head,
          delayMs: 150,
        };
        const id = chainId;
        const dep = await getChunkedLogs(publicClient, depositedEvent, { id }, scanOptions);
        const wdr = await getChunkedLogs(publicClient, withdrawnEvent, { id }, scanOptions);
        const tap = await getChunkedLogs(publicClient, transferAppliedEvent, { id }, scanOptions);
        const events: OnchainEvent[] = [];
        for (const l of dep) {
          const e = logToOnchainEvent(l as Log, "Deposited");
          if (e) events.push(e);
        }
        for (const l of wdr) {
          const e = logToOnchainEvent(l as Log, "Withdrawn");
          if (e) events.push(e);
        }
        for (const l of tap) {
          const e = logToOnchainEvent(l as Log, "TransferApplied");
          if (e) events.push(e);
        }
        onchainRef.current =
          scannedTo === null ? events : [...onchainRef.current, ...events];
        onchainScannedToRef.current = head;
      } finally {
        onchainLoadingRef.current = false;
      }
    }

    async function loadMeta(): Promise<{ exists: boolean }> {
      if (!publicClient) return { exists: false };
      try {
        const [info, active] = await Promise.all([
          publicClient.readContract({
            address: CHAINPOOL_ADDRESS,
            abi: CHAINPOOL_ABI,
            functionName: "chains",
            args: [chainId],
          }) as Promise<readonly [`0x${string}`, Address, boolean, bigint]>,
          publicClient.readContract({
            address: CHAINPOOL_ADDRESS,
            abi: CHAINPOOL_ABI,
            functionName: "isActive",
            args: [chainId],
          }) as Promise<boolean>,
        ]);
        if (cancelled) return { exists: false };
        const ZERO = "0x0000000000000000000000000000000000000000";
        const exists = info[1].toLowerCase() !== ZERO;
        creatorRef.current = exists ? info[1] : null;
        setMeta({
          seedCommit: info[0],
          creator: info[1],
          closed: info[2],
          expiresAt: info[3],
          isActive: active,
        });
        // Settings replay depends on creatorRef; recompute so any settings
        // envelopes that arrived before meta resolved get applied now.
        recomputeRef.current?.();
        return { exists };
      } catch (e) {
        console.warn("loadMeta failed", e);
        return { exists: false };
      }
    }

    async function init() {
      try {
        setLoading(true);
        if (!IS_CONTRACT_CONFIGURED) {
          setError(
            "ChainPool address is unset. Add NEXT_PUBLIC_CHAINPOOL_ADDRESS to app/.env.local and restart.",
          );
          return;
        }
        const { exists } = await loadMeta();
        // If the chain doesn't exist on the current contract (typical after
        // an Anvil restart that wiped state, or a redeploy to a different
        // address), do NOT load any cached/restored envelopes for this id —
        // they're from a prior deployment and would render as ghost messages.
        // Also clear the one-shot restored buffer so it doesn't leak into a
        // future chain that happens to reuse this id.
        if (!exists) {
          if (chainIdStr) clearRestoredEnvelopes(chainIdStr);
          setError(
            `Chain #${chainId.toString()} doesn't exist on the configured ChainPool (${CHAINPOOL_ADDRESS}). It may have been wiped by an Anvil restart, or you're pointing at the wrong contract.`,
          );
          return;
        }
        await loadOnchain();
        // Hydrate from a restored backup (if any) before touching Waku so the
        // chain page renders historical chats instantly. One-shot: clear the
        // buffer after consuming so subsequent visits use Waku live state.
        if (chainIdStr) {
          const restored = loadRestoredEnvelopes(chainIdStr);
          for (const env of restored) ingest(env);
          if (restored.length > 0) clearRestoredEnvelopes(chainIdStr);
          await recompute();
        }
        // Spin up Waku in parallel; chain may render with onchain-only state first.
        const w = await createWakuClient(chainId, CHAINPOOL_ADDRESS);
        if (cancelled) return;
        setWaku(w);
        await w.history((env) => {
          ingest(env);
        });
        await recompute();
        // Helper: republish OUR cached Register envelope (if we have one) so
        // any newly-joined member picks us up via live subscribe — Waku's
        // store-based history is unreliable on the public fleet.
        const republishOwnRegister = async () => {
          if (!address || !chainIdStr) return;
          const cached = loadRegisterEnvelope<ChainEnvelope>(
            chainIdStr,
            address,
          );
          if (!cached) return;
          try {
            await w.publish(cached);
          } catch {
            // ignore — we'll try again on the next tick or on next gossip
          }
        };

        // Same idea for the chain's Settings envelope (creator-published)
        // so newcomers learn the description without a Waku store hit.
        const republishCachedSettings = async () => {
          if (!chainIdStr) return;
          const cached = loadSettingsEnvelope<ChainEnvelope>(chainIdStr);
          if (!cached) return;
          try {
            await w.publish(cached);
          } catch {
            // noop
          }
        };

        unsub = await w.subscribe((env) => {
          const isNew = ingest(env);
          if (!isNew) return;
          void recompute();
          // Gossip-on-encounter: if we just learned about a NEW Register from
          // someone else, re-broadcast ours so they learn about us too.
          if (env.type === "register" && address) {
            const body = env.body as { wallet?: string } | undefined;
            if (
              body?.wallet &&
              body.wallet.toLowerCase() !== address.toLowerCase()
            ) {
              void republishOwnRegister();
            }
          }
        });

        // Initial republish (helps a member who lands on the page after
        // others were already registered) + a few decaying republishes to
        // cover slow Waku peer warmup. Settings come from creator only but
        // every member who has them cached helps gossip them along.
        void republishOwnRegister();
        void republishCachedSettings();
        republishTimer = setInterval(() => {
          republishCount += 1;
          // ~30s window: 6 attempts every 5s, then stop the interval.
          if (republishCount > 6) {
            if (republishTimer) clearInterval(republishTimer);
            republishTimer = null;
            return;
          }
          void republishOwnRegister();
          void republishCachedSettings();
        }, 5000);

        // Poll only newly mined blocks. Full historical scans are expensive on
        // Alchemy's free Sepolia tier, especially with tiny log windows.
        // Meta still refreshes so the expiry indicator
        // becomes accurate when the chain ages past expiresAt)
        pollTimer = setInterval(async () => {
          await loadOnchain();
          await loadMeta();
          await recompute();
        }, 30000);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
      if (unsub) unsub();
      if (pollTimer) clearInterval(pollTimer);
      if (republishTimer) clearInterval(republishTimer);
    };
  }, [chainIdStr, publicClient, address]);

  const refresh = async () => {
    recomputeRef.current?.();
  };

  const addLocalEnvelope = (env: ChainEnvelope) => {
    if (!ingest(env)) return;
    recomputeRef.current?.();
  };

  return {
    state,
    waku,
    meta,
    refresh,
    loading,
    error,
    addLocalEnvelope,
    getRawEnvelopes: () => [...wakuRef.current],
    getOnchainEvents: () => [...onchainRef.current],
  };
}
