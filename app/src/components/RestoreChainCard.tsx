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
  const [swarmReference, setSwarmReference] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function validateBackupBlob(blob: unknown): BackupBlob {
    if (blob === null || typeof blob !== "object" || Array.isArray(blob)) {
      throw new Error("Backup doesn't look like a Pocket Chains backup.");
    }
    const backup = blob as BackupBlob;
    if (typeof backup.schema !== "number" || !backup.chainId || !backup.signature) {
      throw new Error("Backup doesn't look like a Pocket Chains backup.");
    }
    if (typeof backup.signer !== "string") {
      throw new Error("Backup doesn't include a signer.");
    }
    if (backup.signer.toLowerCase() !== address?.toLowerCase()) {
      throw new Error(
        `Backup was signed by ${backup.signer.slice(0, 6)}…${backup.signer.slice(-4)} — switch wallets to that one to restore.`,
      );
    }
    return backup;
  }

  async function restoreBackup(blob: unknown) {
    if (!wallet.data || !address) {
      setStatus({ kind: "error", msg: "Connect a wallet first." });
      return;
    }
    try {
      const backup = validateBackupBlob(blob);

      setStatus({ kind: "loading", step: "Sign in your wallet to derive the decryption key…" });
      const payload = (await importChainBackup({
        walletClient: wallet.data,
        account: address,
        blob: backup,
      })) as BackupPayload;

      setStatus({ kind: "loading", step: "Hydrating local state…" });
      const { chainId } = restoreFromPayload(payload, address);
      router.push(`/chain/${chainId}`);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  async function handleFile(file: File) {
    try {
      setStatus({ kind: "loading", step: "Reading file…" });
      const text = await file.text();
      let blob: BackupBlob;
      try {
        blob = JSON.parse(text) as BackupBlob;
      } catch {
        throw new Error("File isn't valid JSON.");
      }
      await restoreBackup(blob);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  async function handleSwarmRestore() {
    const reference = swarmReference.trim();
    if (!reference) {
      setStatus({ kind: "error", msg: "Enter a Swarm reference first." });
      return;
    }
    try {
      setStatus({ kind: "loading", step: "Fetching backup from Swarm…" });
      const params = new URLSearchParams({ reference });
      const response = await fetch(`/api/swarm/backup?${params.toString()}`);
      const body = (await response.json().catch(() => null)) as {
        backup?: unknown;
        error?: unknown;
      } | null;

      if (!response.ok) {
        const msg = typeof body?.error === "string" ? body.error : "Swarm restore failed.";
        throw new Error(msg);
      }
      if (
        body?.backup === null ||
        typeof body?.backup !== "object" ||
        Array.isArray(body.backup)
      ) {
        throw new Error("Swarm reference did not return a backup.");
      }
      await restoreBackup(body.backup);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  const disabled = status.kind === "loading" || !wallet.data;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-medium text-zinc-900">Restore from backup</h2>
      <p className="text-sm text-zinc-500 mt-1">
        Load a <code className="font-mono text-xs">.backup.json</code> file or paste
        the Swarm reference from a saved backup. Decrypted with the same wallet
        that signed the export.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={swarmReference}
            onChange={(e) => setSwarmReference(e.target.value)}
            placeholder="Swarm reference"
            disabled={disabled}
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSwarmRestore()}
            disabled={disabled || swarmReference.trim().length === 0}
            className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Restore
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
          disabled={disabled}
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
