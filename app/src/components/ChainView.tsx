"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ephKeyFromPrivHex } from "@/lib/ephemeral";
import { useChainState } from "@/lib/useChainState";
import { Composer } from "./Composer";
import { FundsPanel } from "./FundsPanel";
import { InviteQR } from "./InviteQR";
import { MessageStream } from "./MessageStream";

export function ChainView({ chainIdStr }: { chainIdStr: string }) {
  const { address, isConnected } = useAccount();
  const { state, waku, refresh, loading, error } = useChainState(chainIdStr);
  const chainId = useMemo(() => BigInt(chainIdStr), [chainIdStr]);
  const [showInvite, setShowInvite] = useState(false);
  const [seedHex, setSeedHex] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeedHex(window.localStorage.getItem(`pc_seed:${chainIdStr}`));
  }, [chainIdStr]);

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
        <button
          type="button"
          className="text-left rounded px-2 py-1.5 text-sm bg-zinc-900 border border-zinc-800"
        >
          # public
        </button>
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
        {loading && !state ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Loading chain state…
          </div>
        ) : (
          <MessageStream state={state} channelId={0n} />
        )}
        <Composer
          chainId={chainId}
          channelId={0n}
          waku={waku}
          onPublished={() => void refresh()}
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
