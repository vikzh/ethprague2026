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
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (!wallet.data || !address) return;
    setBusy(true);
    setError(null);
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
        className="rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition"
        title="Sign with your wallet to derive a deterministic AES key, then download an encrypted JSON snapshot of this chain."
      >
        {busy ? "Signing…" : "Download encrypted backup"}
      </button>
      {error ? (
        <span className="text-[11px] text-red-600 break-all">{error}</span>
      ) : null}
    </div>
  );
}
