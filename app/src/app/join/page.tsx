"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { type Address, type Hex } from "viem";
import { ConnectButton } from "@/components/ConnectButton";
import { saveChainSeed } from "@/lib/chainKey";
import { upsertLocalChain } from "@/lib/chainsLocal";
import { TARGET_CHAIN_ID } from "@/lib/contract";
import { EIP712_DOMAIN } from "@/lib/eip712";
import { ephKeyFromPrivHex } from "@/lib/ephemeral";
import {
  decodeInviteFromUrl,
  ensureRegistered,
  type WalletInvite,
} from "@/lib/registration";
import { createWakuClient } from "@/lib/waku";

type Status =
  | { kind: "idle" }
  | { kind: "missing"; reason: string }
  | { kind: "ready" }
  | { kind: "joining"; step: string }
  | { kind: "joined" }
  | { kind: "error"; msg: string };

function JoinInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const wallet = useWalletClient();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const chainIdParam = params.get("id");
  const seedHex = useMemo<Hex | null>(() => {
    if (typeof window === "undefined") return null;
    const fragment = window.location.hash.replace(/^#/, "");
    const m = fragment.match(/k=([0-9a-fA-Fx]+)/);
    if (!m) return null;
    let v = m[1];
    if (!v.startsWith("0x")) v = "0x" + v;
    return v as Hex;
  }, []);

  const walletInvite = useMemo<WalletInvite | null>(() => {
    if (typeof window === "undefined") return null;
    const fragment = window.location.hash.replace(/^#/, "");
    const m = fragment.match(/(?:^|&)inv=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    return decodeInviteFromUrl(m[1]);
  }, []);

  useEffect(() => {
    if (!chainIdParam) {
      setStatus({ kind: "missing", reason: "Missing chain id in URL" });
      return;
    }
    if (!seedHex) {
      setStatus({ kind: "missing", reason: "Missing invite secret in URL fragment" });
      return;
    }
    setStatus({ kind: "ready" });
  }, [chainIdParam, seedHex]);

  async function handleJoin() {
    if (!chainIdParam || !seedHex || !wallet.data || !address) return;
    const chainId = BigInt(chainIdParam);
    try {
      ephKeyFromPrivHex(seedHex);
      saveChainSeed(chainId, seedHex);

      setStatus({ kind: "joining", step: "Connecting to Waku…" });
      const waku = await createWakuClient(chainId);

      setStatus({ kind: "joining", step: "Sign the Register message in your wallet…" });
      await ensureRegistered({
        chainId,
        wallet: address,
        walletClient: wallet.data,
        waku,
        isAlreadyMember: false,
        invitePrivHex: seedHex,
        walletInvite,
      });

      upsertLocalChain({ id: chainId.toString(), role: "member" });

      setStatus({ kind: "joined" });
      router.push(`/chain/${chainIdParam}`);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <div className="font-semibold tracking-tight text-zinc-900">
          Pocket<span className="text-slate-600">Chains</span>
        </div>
        <ConnectButton />
      </header>
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 flex flex-col gap-4 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">You&apos;ve been invited</h1>
          {chainIdParam ? (
            <p className="text-sm text-zinc-500">
              Chain <span className="font-mono text-zinc-900">#{chainIdParam}</span>. The invite secret
              comes from the URL fragment and never leaves your browser.
            </p>
          ) : null}
          {walletInvite ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs">
              <div className="text-emerald-800">
                Signed invite from{" "}
                <span className="font-mono">
                  {walletInvite.inviter.slice(0, 6)}…{walletInvite.inviter.slice(-4)}
                </span>
              </div>
              <div className="text-emerald-700/80 mt-1">
                {walletInvite.expiresAt === 0n
                  ? "No expiry"
                  : `Expires ${new Date(Number(walletInvite.expiresAt) * 1000).toLocaleString()}`}
              </div>
            </div>
          ) : null}
          {status.kind === "missing" ? (
            <p className="text-sm text-amber-700">{status.reason}</p>
          ) : null}
          {!isConnected ? (
            <p className="text-sm text-zinc-500">Connect a wallet to accept.</p>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={status.kind === "joining" || status.kind === "joined"}
              className="rounded-full bg-slate-600 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50 transition shadow-sm"
            >
              {status.kind === "joining"
                ? `${status.step}`
                : status.kind === "joined"
                  ? "Joined — redirecting…"
                  : "Accept invite"}
            </button>
          )}
          {status.kind === "error" ? (
            <p className="text-xs text-red-600 break-all">{status.msg}</p>
          ) : null}
          <p className="text-xs text-zinc-500">
            Domain: {EIP712_DOMAIN.name} · chainId {TARGET_CHAIN_ID}
          </p>
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
