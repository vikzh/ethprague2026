"use client";

import { useEffect, useRef, useState } from "react";
import { type Address, getAbiItem, type Log } from "viem";
import { usePublicClient } from "wagmi";
import { CHAINPOOL_ABI, IS_CONTRACT_CONFIGURED } from "./contract";
import { getChunkedLogs } from "./logs";
import { replay, type OnchainEvent, type ReplayResult } from "./state";
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

export interface UseChainStateResult {
  state: ReplayResult | null;
  waku: WakuClient | null;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
  /** Append an envelope to the local replay buffer (e.g. a message we just published). */
  addLocalEnvelope: (env: ChainEnvelope) => void;
}

export function useChainState(chainIdStr: string | null): UseChainStateResult {
  const publicClient = usePublicClient();
  const [state, setState] = useState<ReplayResult | null>(null);
  const [waku, setWaku] = useState<WakuClient | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const onchainRef = useRef<OnchainEvent[]>([]);
  const wakuRef = useRef<ChainEnvelope[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const recomputeRef = useRef<() => void>(() => {});

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

    async function recompute() {
      if (cancelled) return;
      try {
        const result = await replay(chainId, onchainRef.current, wakuRef.current);
        if (!cancelled) setState(result);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    recomputeRef.current = () => void recompute();

    async function loadOnchain() {
      if (!publicClient) return;
      if (!IS_CONTRACT_CONFIGURED) return;
      const id = chainId;
      const [dep, wdr, tap] = await Promise.all([
        getChunkedLogs(publicClient, depositedEvent, { id }),
        getChunkedLogs(publicClient, withdrawnEvent, { id }),
        getChunkedLogs(publicClient, transferAppliedEvent, { id }),
      ]);
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
      onchainRef.current = events;
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
        await loadOnchain();
        // Spin up Waku in parallel; chain may render with onchain-only state first.
        const w = await createWakuClient(chainId);
        if (cancelled) return;
        setWaku(w);
        await w.history((env) => {
          ingest(env);
        });
        await recompute();
        unsub = await w.subscribe((env) => {
          if (ingest(env)) void recompute();
        });
        // poll on-chain events every 8s
        pollTimer = setInterval(async () => {
          await loadOnchain();
          await recompute();
        }, 8000);
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
    };
  }, [chainIdStr, publicClient]);

  const refresh = async () => {
    recomputeRef.current?.();
  };

  const addLocalEnvelope = (env: ChainEnvelope) => {
    if (!ingest(env)) return;
    recomputeRef.current?.();
  };

  return { state, waku, refresh, loading, error, addLocalEnvelope };
}
