"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { type Hex, bytesToHex } from "viem";
import { chatDigest } from "@/lib/eip712";
import { loadOrCreateEphKey, signDigest } from "@/lib/ephemeral";
import { envelopeChat, type WakuClient } from "@/lib/waku";

export function Composer({
  chainId,
  channelId,
  waku,
  onPublished,
}: {
  chainId: bigint;
  channelId: bigint;
  waku: WakuClient | null;
  onPublished?: () => void;
}) {
  const { address } = useAccount();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState<bigint>(BigInt(Date.now()));

  async function send() {
    if (!waku || !address || !text.trim()) return;
    setSending(true);
    try {
      const eph = loadOrCreateEphKey(chainId, address);
      const ts = BigInt(Date.now());
      const contentBytes = new TextEncoder().encode(text);
      const contentHex = ("0x" + bytesToHex(contentBytes).replace(/^0x/, "")) as Hex;
      const digest = chatDigest({
        chainId,
        channelId,
        nonce,
        timestamp: ts,
        contentType: 0,
        content: contentHex,
      });
      const sig = await signDigest(eph.privHex, digest);
      await waku.publish(
        envelopeChat({
          chainId: chainId.toString(),
          channelId: channelId.toString(),
          ephAddr: eph.address,
          nonce: nonce.toString(),
          contentType: 0,
          content: contentHex,
          sig,
        }),
      );
      setText("");
      setNonce((n) => n + 1n);
      onPublished?.();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-zinc-800 p-3 flex items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={waku ? "Message #public…" : "Connecting to Waku…"}
        disabled={!waku || sending}
        className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={!waku || sending || !text.trim()}
        className="rounded-lg bg-white text-black text-sm font-medium px-4 py-2 disabled:opacity-50"
      >
        {sending ? "…" : "Send"}
      </button>
    </div>
  );
}
