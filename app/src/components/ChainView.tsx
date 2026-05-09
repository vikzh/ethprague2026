"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import type { Hex } from "viem";
import { ephKeyFromPrivHex } from "@/lib/ephemeral";
import { ensureRegistered } from "@/lib/registration";
import {
  CHANNEL_PUBLIC,
  CHANNEL_VERIFIED,
  VERIFIED_ONLY_CHANNELS,
} from "@/lib/state";
import { useChainState } from "@/lib/useChainState";
import { Composer } from "./Composer";
import { FundsPanel } from "./FundsPanel";
import { InviteQR } from "./InviteQR";
import { MessageStream } from "./MessageStream";

interface ChannelDef {
  id: bigint;
  name: string;
  verifiedOnly: boolean;
}

const CHANNELS: ChannelDef[] = [
  { id: CHANNEL_PUBLIC, name: "public", verifiedOnly: false },
  { id: CHANNEL_VERIFIED, name: "verified", verifiedOnly: true },
];

export function ChainView({ chainIdStr }: { chainIdStr: string }) {
  const { address, isConnected } = useAccount();
  const wallet = useWalletClient();
  const { state, waku, refresh, loading, error, addLocalEnvelope } =
    useChainState(chainIdStr);
  const chainId = useMemo(() => BigInt(chainIdStr), [chainIdStr]);
  const [showInvite, setShowInvite] = useState(false);
  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [registerStatus, setRegisterStatus] = useState<
    "idle" | "publishing" | "ok" | "error"
  >("idle");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [activeChannelId, setActiveChannelId] = useState<bigint>(CHANNEL_PUBLIC);
  const activeChannel = useMemo(
    () =>
      CHANNELS.find((c) => c.id === activeChannelId) ?? CHANNELS[0]!,
    [activeChannelId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeedHex(window.localStorage.getItem(`pc_seed:${chainIdStr}`));
  }, [chainIdStr]);

  // Poll Waku peer count for the status indicator
  useEffect(() => {
    if (!waku) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const n = await waku.peerCount();
        if (!cancelled) setPeerCount(n);
      } catch {
        // ignore
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [waku]);

  const isMember = useMemo(() => {
    if (!state || !address) return false;
    return state.members.has(address);
  }, [state, address]);

  const handlePublishRegister = useCallback(async () => {
    if (!address || !wallet.data || !waku) return;
    setRegisterError(null);
    setRegisterStatus("publishing");
    try {
      await ensureRegistered({
        chainId,
        wallet: address,
        walletClient: wallet.data,
        waku,
        isAlreadyMember: false,
        seedPrivHex: (seedHex ?? null) as Hex | null,
        addLocalEnvelope,
      });
      setRegisterStatus("ok");
      void refresh();
    } catch (e) {
      console.warn("ChainView: ensureRegistered failed", e);
      // Even on Waku publish failure we may already be locally registered.
      setRegisterStatus("error");
      setRegisterError((e as Error).message);
    }
  }, [address, wallet.data, waku, chainId, seedHex, refresh, addLocalEnvelope]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined" || !seedHex) return null;
    const base = `${window.location.origin}/join?id=${chainIdStr}`;
    return `${base}#k=${seedHex.startsWith("0x") ? seedHex.slice(2) : seedHex}`;
  }, [seedHex, chainIdStr]);

  // Pre-derive ephemeral address (validates persistence works) for display.
  const myEphAddr = useMemo(() => {
    if (typeof window === "undefined" || !address) return null;
    const raw = window.localStorage.getItem(`pc_eph:${chainIdStr}:${address.toLowerCase()}`);
    if (!raw) return null;
    try {
      return ephKeyFromPrivHex(raw as `0x${string}`).address;
    } catch {
      return null;
    }
  }, [address, chainIdStr]);

  if (!isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400">
        Connect a wallet to view this chain.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      {/* Channel sidebar */}
      <aside className="w-full lg:w-56 border-b lg:border-b-0 lg:border-r border-zinc-800 p-3 flex flex-col gap-2 bg-zinc-950">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Channels</div>
        {CHANNELS.map((c) => {
          const active = c.id === activeChannelId;
          return (
            <button
              key={c.id.toString()}
              type="button"
              onClick={() => setActiveChannelId(c.id)}
              className={`text-left rounded px-2 py-1.5 text-sm border transition flex items-center justify-between ${
                active
                  ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                  : "bg-zinc-950 border-zinc-900 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <span># {c.name}</span>
              {c.verifiedOnly ? (
                <span
                  title="Only registered members can post here"
                  className="text-[9px] uppercase tracking-wide text-emerald-400"
                >
                  ✓ verified
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">Members</div>
        <ul className="space-y-1 text-xs font-mono text-zinc-300 max-h-40 overflow-y-auto">
          {state ? (
            [...state.members.values()].length === 0 ? (
              <li className="text-zinc-500 font-sans">none yet</li>
            ) : (
              [...state.members.values()].map((m) => (
                <li key={m.wallet}>
                  {m.wallet.slice(0, 6)}…{m.wallet.slice(-4)}
                </li>
              ))
            )
          ) : (
            <li className="text-zinc-500 font-sans">loading…</li>
          )}
        </ul>
        {inviteUrl ? (
          <div className="mt-auto pt-3">
            <button
              type="button"
              onClick={() => setShowInvite((v) => !v)}
              className="w-full rounded bg-white text-black text-xs font-medium px-3 py-1.5"
            >
              {showInvite ? "Hide invite QR" : "Show invite QR"}
            </button>
          </div>
        ) : null}
      </aside>

      {/* Middle: chat */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        {showInvite && inviteUrl ? (
          <div className="p-4">
            <InviteQR url={inviteUrl} />
          </div>
        ) : null}
        {error ? (
          <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">
            {error}
          </div>
        ) : null}
        <div className="px-4 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-900 flex items-center justify-between">
          <span>
            Waku peers: <span className={peerCount > 0 ? "text-emerald-400" : "text-amber-400"}>{peerCount}</span>
            {" · "}you are {isMember ? <span className="text-emerald-400">a member</span> : <span className="text-amber-400">not yet registered</span>}
          </span>
          {!isMember && address ? (
            <button
              type="button"
              onClick={() => void handlePublishRegister()}
              disabled={registerStatus === "publishing" || !waku}
              className="rounded bg-amber-500 text-black text-[11px] font-medium px-2 py-1 disabled:opacity-50"
            >
              {registerStatus === "publishing" ? "Signing…" : "Publish membership"}
            </button>
          ) : null}
        </div>
        {registerStatus === "error" && registerError ? (
          <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">
            {registerError}
          </div>
        ) : null}
        {loading && !state ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Loading chain state…
          </div>
        ) : (
          <MessageStream state={state} channelId={activeChannel.id} />
        )}
        <Composer
          chainId={chainId}
          channelId={activeChannel.id}
          waku={waku}
          onPublished={() => void refresh()}
          addLocalEnvelope={addLocalEnvelope}
          disabled={
            VERIFIED_ONLY_CHANNELS.has(activeChannel.id.toString()) && !isMember
          }
          disabledReason={
            VERIFIED_ONLY_CHANNELS.has(activeChannel.id.toString()) && !isMember
              ? "Only verified members can write here. Click 'Publish membership' above."
              : undefined
          }
        />
        {myEphAddr ? (
          <div className="px-4 py-1 text-[10px] text-zinc-600 border-t border-zinc-900">
            chat key: {myEphAddr.slice(0, 10)}…{myEphAddr.slice(-6)}
          </div>
        ) : null}
      </section>

      {/* Right: funds */}
      <FundsPanel
        chainId={chainId}
        state={state}
        waku={waku}
        onAfterTx={() => void refresh()}
      />
    </div>
  );
}
