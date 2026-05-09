"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { type Address, type Hex, bytesToHex } from "viem";
import { aesGcmEncrypt } from "@/lib/crypto";
import { chatDigest } from "@/lib/eip712";
import { ecdh, loadOrCreateEphKey, signDigest } from "@/lib/ephemeral";
import { envelopeChat, type ChainEnvelope, type WakuClient } from "@/lib/waku";

export interface DmTarget {
  /** Recipient wallet. */
  toWallet: Address;
  /** Recipient's chat eph pubkey (uncompressed hex). Derived from members map. */
  toEphPubHex: Hex;
}

export function Composer({
  chainId,
  channelId,
  waku,
  onPublished,
  addLocalEnvelope,
  disabled,
  disabledReason,
  dm,
}: {
  chainId: bigint;
  channelId: bigint;
  waku: WakuClient | null;
  onPublished?: () => void;
  addLocalEnvelope?: (env: ChainEnvelope) => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Set when this composer is for a 1:1 DM. Content will be E2E-encrypted. */
  dm?: DmTarget;
}) {
  const { address } = useAccount();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState<bigint>(BigInt(Date.now()));
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (disabled) return;
    if (!waku || !address || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const eph = loadOrCreateEphKey(chainId, address);
      const plainBytes = new TextEncoder().encode(text);

      // For DMs, encrypt with AES-GCM under the ECDH-derived shared key.
      let contentBytes: Uint8Array;
      let contentType: number;
      if (dm) {
        const sharedKey = ecdh(eph.privHex, dm.toEphPubHex);
        contentBytes = await aesGcmEncrypt(sharedKey, plainBytes);
        contentType = 1;
      } else {
        contentBytes = plainBytes;
        contentType = 0;
      }
      const contentHex = ("0x" + bytesToHex(contentBytes).replace(/^0x/, "")) as Hex;

      const env = envelopeChat({
        chainId: chainId.toString(),
        channelId: channelId.toString(),
        ephAddr: eph.address,
        nonce: nonce.toString(),
        contentType,
        content: contentHex,
        sig: "0x" as Hex,
        ...(dm ? { dmTo: dm.toWallet } : {}),
      });
      const digest = chatDigest({
        chainId,
        channelId,
        nonce,
        timestamp: BigInt(env.ts),
        contentType,
        content: contentHex,
      });
      const sig = await signDigest(eph.privHex, digest);
      const finalEnv = { ...env, body: { ...(env.body as object), sig } };

      // Optimistic: render locally before Waku echo (and before peers exist)
      addLocalEnvelope?.(finalEnv);
      setText("");
      setNonce((n) => n + 1n);
      onPublished?.();

      try {
        await waku.publish(finalEnv);
      } catch (e) {
        // Network publish failed; the message is still in local replay so user
        // sees it with a hint that it didn't propagate.
        setError(`Publish failed (Waku peer issue): ${(e as Error).message}`);
        console.warn("Composer: publish failed", e);
      }
    } catch (e) {
      setError((e as Error).message);
      console.warn("Composer: send failed", e);
    } finally {
      setSending(false);
    }
  }

  const placeholder = !waku
    ? "Connecting to Waku…"
    : disabled && disabledReason
      ? disabledReason
      : "Type a message…";

  return (
    <div className="border-t border-zinc-800">
      {error ? (
        <div className="px-3 py-1 text-[11px] text-amber-300 bg-amber-950/30 border-b border-amber-900">
          {error}
        </div>
      ) : null}
      {disabled && disabledReason ? (
        <div className="px-3 py-1 text-[11px] text-zinc-400 bg-zinc-900/60 border-b border-zinc-800">
          {disabledReason}
        </div>
      ) : null}
      <div className="p-3 flex items-center gap-2">
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
          placeholder={placeholder}
          disabled={!waku || sending || !!disabled}
          className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!waku || sending || !text.trim() || !!disabled}
          className="rounded-lg bg-white text-black text-sm font-medium px-4 py-2 disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
