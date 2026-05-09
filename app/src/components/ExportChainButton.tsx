"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { loadChainSeed } from "@/lib/chainKey";
import { getLocalChain } from "@/lib/chainsLocal";
import {
  BACKUP_FILENAME,
  downloadJSON,
  exportChainBackup,
  type BackupPayload,
} from "@/lib/chainExport";
import { loadEphKey } from "@/lib/ephemeral";
import type { ChainEnvelope } from "@/lib/waku";
import type { ReplayResult } from "@/lib/state";

async function uploadBackupToSwarm(filename: string, backup: unknown): Promise<string> {
  const response = await fetch("/api/swarm/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, backup }),
  });
  const body = (await response.json().catch(() => null)) as {
    reference?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok) {
    const msg = typeof body?.error === "string" ? body.error : "Swarm upload failed.";
    throw new Error(msg);
  }
  if (typeof body?.reference !== "string" || body.reference.length === 0) {
    throw new Error("Swarm upload did not return a reference.");
  }
  return body.reference;
}

export function ExportChainButton({
  chainId,
  state,
  rawEnvelopes,
}: {
  chainId: bigint;
  state: ReplayResult | null;
  rawEnvelopes: ChainEnvelope[];
}) {
  const { address } = useAccount();
  const wallet = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swarmError, setSwarmError] = useState<string | null>(null);
  const [swarmReference, setSwarmReference] = useState<string | null>(null);

  async function handleExport() {
    if (!wallet.data || !address) return;
    setBusy(true);
    setStep("Signing backup…");
    setError(null);
    setSwarmError(null);
    setSwarmReference(null);
    try {
      const seed = loadChainSeed(chainId);
      const eph = loadEphKey(chainId, address);
      const local = getLocalChain(chainId.toString());
      const payload: BackupPayload = {
        exportedAt: new Date().toISOString(),
        chainId: chainId.toString(),
        name: local?.name ?? "",
        seedHex: seed ?? undefined,
        ephPrivHex: eph?.privHex ?? undefined,
        members: state
          ? [...state.members.values()].map((m) => ({
              wallet: m.wallet,
              ephAddr: m.ephAddr,
              ephPubHex: m.ephPubHex,
            }))
          : [],
        envelopes: rawEnvelopes,
      };
      const filename = BACKUP_FILENAME(chainId.toString());
      const blob = await exportChainBackup({
        walletClient: wallet.data,
        account: address,
        chainId,
        payload,
      });
      downloadJSON(filename, blob);

      setStep("Uploading to Swarm…");
      try {
        const reference = await uploadBackupToSwarm(filename, blob);
        setSwarmReference(reference);
      } catch (e) {
        setSwarmError((e as Error).message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={busy || !wallet.data}
        className="rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition"
        title="Sign with your wallet to derive a deterministic AES key, then download an encrypted JSON snapshot of this chain."
      >
        {busy ? (step ?? "Saving…") : "Download encrypted backup"}
      </button>
      {error ? (
        <span className="text-[11px] text-red-600 break-all">{error}</span>
      ) : null}
      {swarmReference ? (
        <span className="text-[11px] text-emerald-400 break-all">
          Swarm reference: {swarmReference}
        </span>
      ) : null}
      {swarmError ? (
        <span className="text-[11px] text-amber-300 break-all">
          Local backup downloaded. Swarm upload failed: {swarmError}
        </span>
      ) : null}
    </div>
  );
}
