"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { publishSettings } from "@/lib/settings";
import type { ChainSettings } from "@/lib/state";
import type { ChainEnvelope, WakuClient } from "@/lib/waku";

export function DescriptionPanel({
  chainId,
  settings,
  creator,
  waku,
  addLocalEnvelope,
}: {
  chainId: bigint;
  settings: ChainSettings;
  creator: `0x${string}` | null;
  waku: WakuClient | null;
  addLocalEnvelope?: (env: ChainEnvelope) => void;
}) {
  const { address } = useAccount();
  const wallet = useWalletClient();
  const isCreator = !!address && !!creator && address.toLowerCase() === creator.toLowerCase();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(settings.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(settings.description ?? "");
  }, [settings.description, editing]);

  async function handleSave() {
    if (!wallet.data || !creator) return;
    setBusy(true);
    setError(null);
    try {
      await publishSettings({
        chainId,
        creator,
        walletClient: wallet.data,
        description: draft.trim(),
        waku,
        addLocalEnvelope,
      });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // No description and not the creator → nothing to show.
  if (!settings.description && !isCreator) return null;

  return (
    <div className="px-4 py-2 text-xs border-b border-zinc-900 bg-zinc-950/40">
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={280}
            placeholder="What is this chain about?"
            className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              className="rounded bg-emerald-500 text-black text-xs font-medium px-3 py-1 disabled:opacity-50"
            >
              {busy ? "Signing…" : "Save & publish"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setDraft(settings.description ?? "");
              }}
              disabled={busy}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              Cancel
            </button>
            {error ? (
              <span className="text-[11px] text-red-400 break-all">{error}</span>
            ) : null}
          </div>
          <div className="text-[10px] text-zinc-500">
            Signed by your wallet. Visible to anyone who joins this chain.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 italic text-zinc-300 whitespace-pre-wrap break-words">
            {settings.description || (
              <span className="not-italic text-zinc-600">No description yet.</span>
            )}
          </div>
          {isCreator ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 shrink-0"
            >
              {settings.description ? "Edit" : "Add description"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
