"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { type Address, type Hex } from "viem";
import { bumpVisit, getLocalChain } from "@/lib/chainsLocal";
import { dmChannelId } from "@/lib/dm";
import { ephKeyFromPrivHex } from "@/lib/ephemeral";
import {
  ensureRegistered,
  encodeInviteForUrl,
  signInvite,
  type WalletInvite,
} from "@/lib/registration";
import {
  CHANNEL_PUBLIC,
  CHANNEL_VERIFIED,
  VERIFIED_ONLY_CHANNELS,
  customChannelId,
} from "@/lib/state";
import { useChainState } from "@/lib/useChainState";
import { Composer, type DmTarget } from "./Composer";
import { DescriptionPanel } from "./DescriptionPanel";
import { ExpiryBadge } from "./ExpiryBadge";
import { ExportChainButton } from "./ExportChainButton";
import { FundsPanel } from "./FundsPanel";
import { InviteQR } from "./InviteQR";
import { MessageStream } from "./MessageStream";
import { PollPanel } from "./PollPanel";

interface ChannelDef {
  id: bigint;
  name: string;
  verifiedWrite: boolean;
  creatorWrite: boolean;
  isDefault: boolean;
}

const DEFAULT_CHANNELS: ChannelDef[] = [
  { id: CHANNEL_PUBLIC, name: "public", verifiedWrite: false, creatorWrite: false, isDefault: true },
  { id: CHANNEL_VERIFIED, name: "verified", verifiedWrite: true, creatorWrite: false, isDefault: true },
];

type View =
  | { kind: "channel"; channel: ChannelDef }
  | { kind: "dm"; counterparty: Address }
  | { kind: "polls" };

export function ChainView({ chainIdStr }: { chainIdStr: string }) {
  const { address, isConnected } = useAccount();
  const wallet = useWalletClient();
  const {
    state,
    waku,
    meta,
    refresh,
    loading,
    error,
    addLocalEnvelope,
    getRawEnvelopes,
  } = useChainState(chainIdStr);
  const chainId = useMemo(() => BigInt(chainIdStr), [chainIdStr]);
  const [showInvite, setShowInvite] = useState(false);
  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [signedInvite, setSignedInvite] = useState<WalletInvite | null>(null);
  const [inviteSigning, setInviteSigning] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [registerStatus, setRegisterStatus] = useState<
    "idle" | "publishing" | "ok" | "error"
  >("idle");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [view, setView] = useState<View>({
    kind: "channel",
    channel: DEFAULT_CHANNELS[0]!,
  });

  const allChannels = useMemo<ChannelDef[]>(() => {
    const customs = (state?.settings.customChannels ?? []).map((c) => ({
      id: customChannelId(c.name),
      name: c.name,
      verifiedWrite: c.write === "verified" || c.write === "creator",
      creatorWrite: c.write === "creator",
      isDefault: false,
    }));
    return [...DEFAULT_CHANNELS, ...customs];
  }, [state?.settings.customChannels]);

  useEffect(() => {
    if (view.kind !== "channel") return;
    const stillThere = allChannels.find((c) => c.id === view.channel.id);
    if (!stillThere) {
      setView({ kind: "channel", channel: DEFAULT_CHANNELS[0]! });
    }
  }, [allChannels, view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeedHex(window.localStorage.getItem(`pc_seed:${chainIdStr}`));
    bumpVisit(chainIdStr);
  }, [chainIdStr]);

  void getLocalChain;

  useEffect(() => {
    if (!waku) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const n = await waku.peerCount();
        if (!cancelled) setPeerCount(n);
      } catch {
        // ignore
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [waku]);

  const isMember = useMemo(() => {
    if (!state || !address) return false;
    return state.members.has(address);
  }, [state, address]);

  const handlePublishRegister = useCallback(async () => {
    if (!address || !wallet.data || !waku) return;
    setRegisterError(null);
    setRegisterStatus("publishing");
    try {
      await ensureRegistered({
        chainId,
        wallet: address,
        walletClient: wallet.data,
        waku,
        isAlreadyMember: false,
        seedPrivHex: (seedHex ?? null) as Hex | null,
        addLocalEnvelope,
      });
      setRegisterStatus("ok");
      void refresh();
    } catch (e) {
      console.warn("ChainView: ensureRegistered failed", e);
      setRegisterStatus("error");
      setRegisterError((e as Error).message);
    }
  }, [address, wallet.data, waku, chainId, seedHex, refresh, addLocalEnvelope]);

  const inviteMode = state?.settings.inviteMode ?? "open";
  const isCreator =
    !!address && !!meta?.creator && address.toLowerCase() === meta.creator.toLowerCase();
  const canInvite =
    inviteMode === "open" ||
    (inviteMode === "creator-only" && isCreator) ||
    (inviteMode === "member-approved" && isMember);
  const needsWalletSig = inviteMode !== "open";

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined" || !seedHex) return null;
    if (needsWalletSig && !signedInvite) return null;
    const base = `${window.location.origin}/join?id=${chainIdStr}`;
    let frag = `k=${seedHex.startsWith("0x") ? seedHex.slice(2) : seedHex}`;
    if (signedInvite) {
      frag += `&inv=${encodeInviteForUrl(signedInvite)}`;
    }
    return `${base}#${frag}`;
  }, [seedHex, chainIdStr, signedInvite, needsWalletSig]);

  useEffect(() => {
    setSignedInvite(null);
  }, [inviteMode]);

  async function handleInviteToggle() {
    if (showInvite) {
      setShowInvite(false);
      return;
    }
    setInviteError(null);
    if (needsWalletSig && !signedInvite) {
      if (!wallet.data || !address) {
        setInviteError("Connect a wallet to sign an invite.");
        return;
      }
      setInviteSigning(true);
      try {
        const inv = await signInvite({
          walletClient: wallet.data,
          account: address,
          chainId,
          ttlSeconds: 24 * 3600,
        });
        setSignedInvite(inv);
      } catch (e) {
        setInviteError((e as Error).message);
        setInviteSigning(false);
        return;
      }
      setInviteSigning(false);
    }
    setShowInvite(true);
  }

  const myEphAddr = useMemo(() => {
    if (typeof window === "undefined" || !address) return null;
    const raw = window.localStorage.getItem(`pc_eph:${chainIdStr}:${address.toLowerCase()}`);
    if (!raw) return null;
    try {
      return ephKeyFromPrivHex(raw as `0x${string}`).address;
    } catch {
      return null;
    }
  }, [address, chainIdStr]);

  if (!isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        Connect a wallet to view this chain.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-white">
      {/* Channel sidebar */}
      <aside className="w-full lg:w-60 border-b lg:border-b-0 lg:border-r border-zinc-200 p-3 flex flex-col gap-2 bg-zinc-50 overflow-y-auto">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Channels</div>
        {allChannels.map((c) => {
          const active = view.kind === "channel" && view.channel.id === c.id;
          const tooltip = c.creatorWrite
            ? "Only the chain creator can post here"
            : c.verifiedWrite
              ? "Only verified members can post here"
              : undefined;
          return (
            <button
              key={c.id.toString()}
              type="button"
              onClick={() => setView({ kind: "channel", channel: c })}
              title={tooltip}
              className={`text-left rounded-lg px-2.5 py-1.5 text-sm border transition flex items-center justify-between ${
                active
                  ? "bg-sky-50 border-sky-200 text-sky-900"
                  : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span>
                {c.creatorWrite ? "📣" : "#"} {c.name}
              </span>
              {c.creatorWrite ? (
                <span className="text-[9px] uppercase tracking-wide text-amber-700">
                  📣 creator
                </span>
              ) : c.verifiedWrite ? (
                <span className="text-[9px] uppercase tracking-wide text-emerald-700">
                  ✓ verified
                </span>
              ) : null}
            </button>
          );
        })}

        {(() => {
          const active = view.kind === "polls";
          const pollsCount = state?.polls.size ?? 0;
          return (
            <button
              type="button"
              onClick={() => setView({ kind: "polls" })}
              className={`text-left rounded-lg px-2.5 py-1.5 text-sm border transition flex items-center justify-between ${
                active
                  ? "bg-sky-50 border-sky-200 text-sky-900"
                  : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span>🗳 polls</span>
              {pollsCount > 0 ? (
                <span className="text-[10px] text-zinc-500 font-mono">{pollsCount}</span>
              ) : null}
            </button>
          );
        })()}

        <div className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">
          Direct messages
        </div>
        <ul className="space-y-1">
          {state ? (
            (() => {
              const others = [...state.members.values()].filter(
                (m) => !address || m.wallet.toLowerCase() !== address.toLowerCase(),
              );
              if (!address || !isMember) {
                return (
                  <li className="text-[11px] text-zinc-500 px-1">
                    Publish your membership to see DMs.
                  </li>
                );
              }
              if (others.length === 0) {
                return <li className="text-[11px] text-zinc-500 px-1">no other members</li>;
              }
              return others.map((m) => {
                const active =
                  view.kind === "dm" &&
                  view.counterparty.toLowerCase() === m.wallet.toLowerCase();
                return (
                  <li key={m.wallet}>
                    <button
                      type="button"
                      onClick={() => setView({ kind: "dm", counterparty: m.wallet })}
                      className={`w-full text-left rounded-lg px-2.5 py-1.5 text-sm border transition flex items-center justify-between font-mono ${
                        active
                          ? "bg-sky-50 border-sky-200 text-sky-900"
                          : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                      }`}
                    >
                      <span>
                        🔒 {m.wallet.slice(0, 6)}…{m.wallet.slice(-4)}
                      </span>
                      <span className="text-[9px] uppercase tracking-wide text-amber-700 font-sans">
                        e2e
                      </span>
                    </button>
                  </li>
                );
              });
            })()
          ) : (
            <li className="text-[11px] text-zinc-500 px-1">loading…</li>
          )}
        </ul>

        <div className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">Members</div>
        <ul className="space-y-1 text-xs font-mono text-zinc-700 max-h-40 overflow-y-auto">
          {state ? (
            [...state.members.values()].length === 0 ? (
              <li className="text-zinc-500 font-sans">none yet</li>
            ) : (
              [...state.members.values()].map((m) => (
                <li key={m.wallet}>
                  {m.wallet.slice(0, 6)}…{m.wallet.slice(-4)}
                </li>
              ))
            )
          ) : (
            <li className="text-zinc-500 font-sans">loading…</li>
          )}
        </ul>
        {seedHex ? (
          <div className="mt-auto pt-3 flex flex-col gap-1">
            {canInvite ? (
              <button
                type="button"
                onClick={() => void handleInviteToggle()}
                disabled={inviteSigning}
                className="w-full rounded-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition"
              >
                {inviteSigning
                  ? "Signing invite…"
                  : showInvite
                    ? "Hide invite QR"
                    : needsWalletSig && !signedInvite
                      ? "Generate signed invite"
                      : "Show invite QR"}
              </button>
            ) : (
              <div className="text-[10px] text-zinc-500 text-center px-1">
                {inviteMode === "creator-only"
                  ? "Only the chain creator can invite people."
                  : "Become a member to invite people."}
              </div>
            )}
            {inviteError ? (
              <span className="text-[10px] text-red-600 break-all">{inviteError}</span>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Middle: chat */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0 bg-white">
        {showInvite && inviteUrl ? (
          <div className="p-4 bg-zinc-50/60">
            <InviteQR url={inviteUrl} />
          </div>
        ) : null}
        {error ? (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">
            {error}
          </div>
        ) : null}
        <div className="px-4 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-200 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-2 flex-wrap">
            <span>
              Waku peers:{" "}
              <span className={peerCount > 0 ? "text-emerald-600" : "text-amber-600"}>
                {peerCount}
              </span>
              {" · "}you are{" "}
              {isMember ? (
                <span className="text-emerald-600">a member</span>
              ) : (
                <span className="text-amber-600">not yet registered</span>
              )}
            </span>
            {meta ? <ExpiryBadge expiresAt={meta.expiresAt} /> : null}
            {meta?.closed ? (
              <span className="text-[10px] uppercase tracking-wide text-red-700 border border-red-300 rounded-full px-2 py-0.5 bg-red-50">
                closed
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {!isMember && address ? (
              <button
                type="button"
                onClick={() => void handlePublishRegister()}
                disabled={registerStatus === "publishing" || !waku}
                className="rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-medium px-2 py-1 disabled:opacity-50 transition"
              >
                {registerStatus === "publishing" ? "Signing…" : "Publish membership"}
              </button>
            ) : null}
            {address ? (
              <a
                href={`/chain/${chainIdStr}/fork`}
                className="rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-medium px-3 py-1.5 transition"
                title="Spawn a sibling chain marked as forked from this one. Members of this chain don't auto-migrate."
              >
                Fork chain
              </a>
            ) : null}
            {address ? (
              <ExportChainButton
                chainId={chainId}
                state={state}
                rawEnvelopes={getRawEnvelopes()}
              />
            ) : null}
          </span>
        </div>
        {meta && !meta.isActive ? (
          <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
            This chain is no longer active. New deposits and transfers are
            blocked. Withdrawals stay open. You can still download an encrypted
            backup of the chat history.
          </div>
        ) : null}
        <DescriptionPanel
          chainId={chainId}
          settings={state?.settings ?? {}}
          creator={meta?.creator ?? null}
          waku={waku}
          addLocalEnvelope={addLocalEnvelope}
        />
        {registerStatus === "error" && registerError ? (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">
            {registerError}
          </div>
        ) : null}
        {(() => {
          if (loading && !state) {
            return (
              <div className="flex-1 flex items-center justify-center text-zinc-500">
                Loading chain state…
              </div>
            );
          }
          const expired = !!meta && !meta.isActive;
          if (view.kind === "polls") {
            return (
              <PollPanel
                chainId={chainId}
                state={state}
                waku={waku}
                isMember={isMember}
                addLocalEnvelope={addLocalEnvelope}
                expired={expired}
              />
            );
          }
          if (view.kind === "channel") {
            const isVerifiedOnly =
              view.channel.verifiedWrite ||
              VERIFIED_ONLY_CHANNELS.has(view.channel.id.toString());
            const isCreatorOnly = view.channel.creatorWrite;
            const failsCreator = isCreatorOnly && !isCreator;
            const failsVerified = !failsCreator && isVerifiedOnly && !isMember;
            const cantWrite = failsCreator || failsVerified || expired;
            const reason = expired
              ? "Chain expired — chat is frozen."
              : failsCreator
                ? "Only the chain creator can post in this channel."
                : failsVerified
                  ? "Only verified members can write here. Click 'Publish membership' above."
                  : undefined;
            return (
              <>
                <MessageStream state={state} channelId={view.channel.id} />
                <Composer
                  chainId={chainId}
                  channelId={view.channel.id}
                  waku={waku}
                  onPublished={() => void refresh()}
                  addLocalEnvelope={addLocalEnvelope}
                  disabled={cantWrite}
                  disabledReason={reason}
                />
              </>
            );
          }
          if (!address || !isMember) {
            return (
              <div className="flex-1 flex items-center justify-center px-6 text-zinc-500 text-sm">
                Publish your membership to use DMs.
              </div>
            );
          }
          const counterpartyMember = state?.members.get(view.counterparty);
          if (!counterpartyMember) {
            return (
              <div className="flex-1 flex items-center justify-center px-6 text-zinc-500 text-sm">
                Couldn&apos;t find that member. They may have dropped off.
              </div>
            );
          }
          const dmId = dmChannelId(address, counterpartyMember.wallet);
          const dmTarget: DmTarget = {
            toWallet: counterpartyMember.wallet,
            toEphPubHex: counterpartyMember.ephPubHex,
          };
          return (
            <>
              <div className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                <span>🔒</span>
                <span>
                  End-to-end encrypted with{" "}
                  <span className="font-mono">
                    {counterpartyMember.wallet.slice(0, 6)}…
                    {counterpartyMember.wallet.slice(-4)}
                  </span>
                </span>
              </div>
              <MessageStream state={state} channelId={dmId} />
              <Composer
                chainId={chainId}
                channelId={dmId}
                waku={waku}
                onPublished={() => void refresh()}
                addLocalEnvelope={addLocalEnvelope}
                dm={dmTarget}
                disabled={expired}
                disabledReason={expired ? "Chain expired — chat is frozen." : undefined}
              />
            </>
          );
        })()}
        {myEphAddr ? (
          <div className="px-4 py-1 text-[10px] text-zinc-400 border-t border-zinc-200">
            chat key: {myEphAddr.slice(0, 10)}…{myEphAddr.slice(-6)}
          </div>
        ) : null}
      </section>

      {/* Right: funds */}
      <FundsPanel
        chainId={chainId}
        state={state}
        waku={waku}
        onAfterTx={() => void refresh()}
      />
    </div>
  );
}
