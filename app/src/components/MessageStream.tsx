"use client";

import type { ChatRecord, ReplayResult } from "@/lib/state";
import { useEffect, useRef } from "react";

export function MessageStream({
  state,
  channelId,
}: {
  state: ReplayResult | null;
  channelId: bigint;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chats: ChatRecord[] = state?.channels.get(channelId.toString()) ?? [];

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [chats.length]);

  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-zinc-950"
    >
      {chats.length === 0 ? (
        <p className="text-sm text-zinc-500">No messages yet. Say hi.</p>
      ) : (
        chats.map((c) => (
          <div key={`${c.fromEphAddr}:${c.nonce.toString()}`} className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-zinc-400">
                {c.fromWallet.slice(0, 6)}…{c.fromWallet.slice(-4)}
              </span>
              {c.verified ? (
                <span
                  title="Sender's eph key is bound to a wallet via a verified Register message"
                  className="text-[10px] uppercase tracking-wide text-emerald-400 border border-emerald-500/40 rounded px-1 py-px"
                >
                  ✓ verified
                </span>
              ) : (
                <span
                  title="Sender hasn't published a Register message yet — eph key not bound to a wallet"
                  className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-700 rounded px-1 py-px"
                >
                  unverified
                </span>
              )}
              <span className="text-[10px] text-zinc-600">
                {new Date(c.ts).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-sm text-zinc-100 whitespace-pre-wrap break-words">
              {c.text}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
