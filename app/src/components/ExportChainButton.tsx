"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { BACKUP_FILENAME, downloadJSON, exportChainBackup } from "@/lib/chainExport";
import type { ChainEnvelope } from "@/lib/waku";
import type { OnchainEvent, ReplayResult } from "@/lib/state";

export function ExportChainButton({
  chainId,
  state,
  rawEnvelopes,
  onchainEvents,
}: {
  chainId: bigint;
  state: ReplayResult | null;
  rawEnvelopes: ChainEnvelope[];
  onchainEvents: OnchainEvent[];
}) {
  const { address } = useAccount();
  const wallet = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (!wallet.data || !address) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        chainId: chainId.toString(),
        members: state ? [...state.members.values()] : [],
        // raw envelopes — full Waku log, ciphertext for non-DM still encrypted
        // by the chain key (which the holder of the seed can decrypt later).
        envelopes: rawEnvelopes,
        onchainEvents: onchainEvents.map((e) => ({
          kind: e.data.kind,
          blockNumber: e.blockNumber,
          logIndex: e.logIndex,
          data: e.data,
        })),
      };
      const blob = await exportChainBackup({
        walletClient: wallet.data,
        account: address,
        chainId,
        payload,
      });
      downloadJSON(BACKUP_FILENAME(chainId.toString()), blob);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={busy || !wallet.data}
        className="rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
        title="Sign with your wallet to derive a deterministic AES key, then download an encrypted JSON snapshot of this chain."
      >
        {busy ? "Signing…" : "Download encrypted backup"}
      </button>
      {error ? (
        <span className="text-[11px] text-red-400 break-all">{error}</span>
      ) : null}
    </div>
  );
}
