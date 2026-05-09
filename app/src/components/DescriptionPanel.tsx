"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import type { CustomChannelDef } from "@/lib/eip712";
import { publishSettings } from "@/lib/settings";
import type { ChainSettings } from "@/lib/state";
import type { ChainEnvelope, WakuClient } from "@/lib/waku";
import { CustomChannelsEditor } from "./CustomChannelsEditor";

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
  const [draftDiscoverable, setDraftDiscoverable] = useState<boolean>(
    settings.discoverable ?? true,
  );
  const [draftInviteMode, setDraftInviteMode] = useState<
    "open" | "creator-only" | "member-approved"
  >(settings.inviteMode ?? "open");
  const [draftChannels, setDraftChannels] = useState<CustomChannelDef[]>(
    settings.customChannels ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(settings.description ?? "");
      setDraftDiscoverable(settings.discoverable ?? true);
      setDraftInviteMode(settings.inviteMode ?? "open");
      setDraftChannels(settings.customChannels ?? []);
    }
  }, [
    settings.description,
    settings.discoverable,
    settings.inviteMode,
    settings.customChannels,
    editing,
  ]);

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
        discoverable: draftDiscoverable,
        inviteMode: draftInviteMode,
        customChannels: draftChannels,
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

  const isPrivate = settings.discoverable === false;
  // Show the panel if there's anything to display: a description, a private
  // marker, or this user is the creator (so they get the edit affordance).
  if (!settings.description && !isPrivate && !isCreator) return null;

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
          <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={draftDiscoverable}
              onChange={(e) => setDraftDiscoverable(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span className="flex flex-col">
              <span>Discoverable in the global Discover list</span>
              <span className="text-[10px] text-zinc-500">
                When off, members who have cached this chain hide it from their
                Discover list. The on-chain creation event remains permanent.
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              Invite policy
            </span>
            <select
              value={draftInviteMode}
              onChange={(e) =>
                setDraftInviteMode(
                  e.target.value as "open" | "creator-only" | "member-approved",
                )
              }
              className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
            >
              <option value="open">Open — anyone with the seed link can join</option>
              <option value="creator-only">Creator-only — every join needs your wallet sig</option>
              <option value="member-approved">Member-approved — any member can invite</option>
            </select>
          </label>
          <CustomChannelsEditor value={draftChannels} onChange={setDraftChannels} />
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
                setDraftDiscoverable(settings.discoverable ?? true);
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
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="italic text-zinc-300 whitespace-pre-wrap break-words">
              {settings.description || (
                <span className="not-italic text-zinc-600">No description yet.</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isPrivate ? (
                <span className="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-500/40 rounded px-1.5 py-0.5">
                  🔒 hidden from Discover
                </span>
              ) : null}
              {settings.inviteMode && settings.inviteMode !== "open" ? (
                <span
                  title={
                    settings.inviteMode === "creator-only"
                      ? "Only the creator can mint invites"
                      : "Any member can mint invites"
                  }
                  className="text-[10px] uppercase tracking-wide text-emerald-300 border border-emerald-500/40 rounded px-1.5 py-0.5"
                >
                  {settings.inviteMode === "creator-only"
                    ? "🛂 creator-only invites"
                    : "🛂 member-approved invites"}
                </span>
              ) : null}
            </div>
          </div>
          {isCreator ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 shrink-0"
            >
              {settings.description || isPrivate ? "Edit" : "Add description"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
