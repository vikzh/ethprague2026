"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import {
  importChainBackup,
  restoreFromPayload,
  type BackupBlob,
  type BackupPayload,
} from "@/lib/chainExport";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "error"; msg: string };

export function RestoreChainCard() {
  const router = useRouter();
  const { address } = useAccount();
  const wallet = useWalletClient();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    if (!wallet.data || !address) {
      setStatus({ kind: "error", msg: "Connect a wallet first." });
      return;
    }
    try {
      setStatus({ kind: "loading", step: "Reading file…" });
      const text = await file.text();
      let blob: BackupBlob;
      try {
        blob = JSON.parse(text) as BackupBlob;
      } catch {
        throw new Error("File isn't valid JSON.");
      }
      if (typeof blob.schema !== "number" || !blob.chainId || !blob.signature) {
        throw new Error("File doesn't look like a Pocket Chains backup.");
      }
      if (blob.signer.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          `Backup was signed by ${blob.signer.slice(0, 6)}…${blob.signer.slice(-4)} — switch wallets to that one to restore.`,
        );
      }

      setStatus({ kind: "loading", step: "Sign in your wallet to derive the decryption key…" });
      const payload = (await importChainBackup({
        walletClient: wallet.data,
        account: address,
        blob,
      })) as BackupPayload;

      setStatus({ kind: "loading", step: "Hydrating local state…" });
      const { chainId } = restoreFromPayload(payload, address);
      router.push(`/chain/${chainId}`);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-medium text-zinc-900">Restore from backup</h2>
      <p className="text-sm text-zinc-500 mt-1">
        Load a <code className="font-mono text-xs">.backup.json</code> you previously
        downloaded. Decrypted with the same wallet that signed the export.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
          disabled={status.kind === "loading" || !wallet.data}
          className="text-xs text-zinc-700 file:mr-3 file:rounded-full file:border-0 file:bg-sky-500 file:text-white file:text-sm file:font-medium file:px-4 file:py-1.5 file:cursor-pointer hover:file:bg-sky-600"
        />
        {status.kind === "loading" ? (
          <span className="text-xs text-zinc-500">{status.step}</span>
        ) : null}
        {status.kind === "error" ? (
          <span className="text-xs text-red-600 break-words">{status.msg}</span>
        ) : null}
      </div>
    </div>
  );
}
