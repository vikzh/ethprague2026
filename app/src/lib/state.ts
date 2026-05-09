"use client";

import {
  type Address,
  type Hex,
  getAddress,
  hexToBytes,
  keccak256,
  recoverAddress,
  stringToHex,
} from "viem";
import { loadChainKey } from "./chainKey";
import { aesGcmDecrypt } from "./crypto";
import { dmChannelId, isDmChannelId } from "./dm";
import { ecdh, ephAddressFromPubHex } from "./ephemeral";
import {
  buildRegisterMessage,
  chatDigest,
  joinProofDigest,
  parseCustomChannels,
  pollDigest,
  recoverInviteSigner,
  recoverRegisterSigner,
  recoverSettingsSigner,
  recoverTransferSigner,
  voteDigest,
  type CustomChannelDef,
  type InviteMode,
  type SignedTransfer,
  type TransferMessage,
} from "./eip712";
import type { ChainEnvelope } from "./waku";

/** Caller-supplied viewer context used to decrypt 1:1 DMs locally. */
export interface ViewerCtx {
  wallet: Address;
  ephPriv: Hex;
}

/** Resolved chain-level settings, derived from the latest valid Settings
 *  envelope signed by the on-chain creator. Empty means no settings published yet. */
export interface ChainSettings {
  description?: string;
  /** Whether the chain is shown in the global Discover list. Undefined means
   *  no settings envelope yet; UI should treat that as discoverable=true. */
  discoverable?: boolean;
  /** Who is allowed to bring new members in. Undefined treated as "open". */
  inviteMode?: InviteMode;
  /** Creator-defined channels in addition to the built-in #public and
   *  #verified. Empty when no settings envelope or no customs were declared. */
  customChannels?: CustomChannelDef[];
}

/** Deterministic channel id for a custom channel, derived from a normalized
 *  name. High bit 254 set so customs never collide with the small reserved
 *  ids (#public=0, #verified=1, …) or with DM channels (bit 255). */
export function customChannelId(name: string): bigint {
  const norm = name.trim().toLowerCase();
  return BigInt(keccak256(stringToHex(`pocketchains:channel:${norm}`))) | (1n << 254n);
}

export interface MemberRecord {
  wallet: Address;
  ephAddr: Address;
  ephPubHex: Hex;
  joinedAtTs: number;
}

export interface ChatRecord {
  chainId: bigint;
  channelId: bigint;
  fromWallet: Address; // resolved from ephAddr -> member, or eph addr if unregistered
  fromEphAddr: Address;
  nonce: bigint;
  ts: number;
  text: string;
  /** True when the sender's eph key is bound to a wallet via a verified Register message. */
  verified: boolean;
}

export interface PollRecord {
  chainId: bigint;
  pollId: string;
  question: string;
  options: string[];
  deadline: bigint; // unix seconds
  creatorWallet: Address;
  ts: number;
  /** wallet -> chosen option index (last vote per wallet wins) */
  votes: Map<Address, number>;
  /** total votes per option, derived */
  tally: number[];
  /** ephemeral, internally tracked latest vote nonce per wallet */
  latestVoteNonce: Map<Address, bigint>;
}

/** Channel ids. */
export const CHANNEL_PUBLIC = 0n;
export const CHANNEL_VERIFIED = 1n;
export const CHANNEL_PRIVATE = 2n;
/** Channels that drop chats from unverified (un-registered) senders. */
export const VERIFIED_ONLY_CHANNELS = new Set<string>([
  CHANNEL_VERIFIED.toString(),
  CHANNEL_PRIVATE.toString(),
]);
/** Channels that should only be *readable* by verified viewers. UI enforces this;
 *  underlying Waku bytes are still public until v0.5 adds ECDH encryption. */
export const PRIVATE_CHANNELS = new Set<string>([CHANNEL_PRIVATE.toString()]);

export interface OnchainEvent {
  kind: "Deposited" | "Withdrawn" | "TransferApplied";
  blockNumber: bigint;
  logIndex: number;
  data:
    | { kind: "Deposited"; from: Address; amount: bigint }
    | { kind: "Withdrawn"; to: Address; amount: bigint }
    | {
        kind: "TransferApplied";
        from: Address;
        to: Address;
        amount: bigint;
        nonce: bigint;
      };
}

export interface ReplayResult {
  chainId: bigint;
  members: Map<Address, MemberRecord>; // keyed by wallet
  membersByEph: Map<Address, MemberRecord>; // keyed by ephAddr
  channels: Map<string, ChatRecord[]>; // channelId.toString() -> chats (sorted)
  polls: Map<string, PollRecord>; // pollId -> poll record (newest first when listed)
  settings: ChainSettings; // chain-level "soft policy" published by creator
  onchainBalance: Map<Address, bigint>;
  lastNonceOnchain: Map<Address, bigint>;
  pendingTransfers: SignedTransfer[]; // sorted by (from asc, nonce asc)
  pendingDelta: Map<Address, bigint>; // sum(in) - sum(out) per wallet
  effectiveBalance: Map<Address, bigint>;
}

function inc(m: Map<Address, bigint>, k: Address, delta: bigint) {
  m.set(k, (m.get(k) ?? 0n) + delta);
}

function decode<T>(value: unknown): T | undefined {
  if (value && typeof value === "object") return value as T;
  return undefined;
}

interface RegisterCandidate {
  member: MemberRecord;
  /** If the Register included a wallet-signed Invite, the recovered inviter
   *  address. Used by replay's policy enforcement. */
  inviter: Address | null;
  ts: number;
}

async function verifyRegister(
  env: ChainEnvelope,
  chainId: bigint,
): Promise<RegisterCandidate | null> {
  type RegBody = {
    chainId: string;
    wallet: string;
    ephAddr: string;
    ephPubHex: Hex;
    joinProofSig: Hex;
    registerSig: Hex;
    inviterAddr?: string;
    inviteExpiresAt?: string;
    inviteNonce?: string;
    inviteSig?: Hex;
  };
  const body = decode<RegBody>(env.body);
  if (!body) return null;
  let wallet: Address;
  let ephAddr: Address;
  try {
    wallet = getAddress(body.wallet);
    ephAddr = getAddress(body.ephAddr);
  } catch {
    return null;
  }
  if (BigInt(body.chainId) !== chainId) return null;
  // 1. ephAddr must match the public key
  let derivedEphAddr: Address;
  try {
    derivedEphAddr = ephAddressFromPubHex(body.ephPubHex);
  } catch {
    return null;
  }
  if (derivedEphAddr.toLowerCase() !== ephAddr.toLowerCase()) return null;
  // 2. registerSig must be by `wallet` over the EIP-712 Register typed data
  const regMsg = buildRegisterMessage({ chainId, wallet, ephAddr, ephPubHex: body.ephPubHex });
  let regSigner: Address;
  try {
    regSigner = await recoverRegisterSigner(regMsg, body.registerSig);
  } catch {
    return null;
  }
  if (regSigner.toLowerCase() !== wallet.toLowerCase()) return null;

  // 3. If a wallet-signed invite is present, verify it. The recovered inviter
  //    is returned so the membership phase can apply policy.
  let inviter: Address | null = null;
  if (body.inviteSig && body.inviterAddr) {
    try {
      const inviterAddr = getAddress(body.inviterAddr);
      const expiresAt = BigInt(body.inviteExpiresAt ?? "0");
      const nonce = BigInt(body.inviteNonce ?? "0");
      const recovered = await recoverInviteSigner(
        { chainId, inviter: inviterAddr, expiresAt, nonce },
        body.inviteSig,
      );
      if (recovered.toLowerCase() === inviterAddr.toLowerCase()) {
        // Soft expiry check: drop the invite if the envelope was sent after expiry.
        if (expiresAt === 0n || BigInt(env.ts) <= expiresAt * 1000n) {
          inviter = inviterAddr;
        }
      }
    } catch {
      // bad invite — leave inviter=null; policy enforcement will reject if needed
    }
  }

  return {
    member: { wallet, ephAddr, ephPubHex: body.ephPubHex, joinedAtTs: env.ts },
    inviter,
    ts: env.ts,
  };
}

async function verifyChat(
  env: ChainEnvelope,
  chainId: bigint,
  members: Map<Address, MemberRecord>,
  membersByEph: Map<Address, MemberRecord>,
  viewer: ViewerCtx | null,
): Promise<ChatRecord | null> {
  type ChatBody = {
    chainId: string;
    channelId: string;
    ephAddr: string;
    nonce: string;
    contentType: number;
    content: Hex;
    sig: Hex;
    dmTo?: string;
  };
  const body = decode<ChatBody>(env.body);
  if (!body) return null;
  let ephAddr: Address;
  try {
    ephAddr = getAddress(body.ephAddr);
  } catch {
    return null;
  }
  if (BigInt(body.chainId) !== chainId) return null;
  const digest = chatDigest({
    chainId,
    channelId: BigInt(body.channelId),
    nonce: BigInt(body.nonce),
    timestamp: BigInt(env.ts),
    contentType: body.contentType,
    content: body.content,
  });
  let signer: Address;
  try {
    signer = await recoverAddress({ hash: digest, signature: body.sig });
  } catch {
    return null;
  }
  if (signer.toLowerCase() !== ephAddr.toLowerCase()) return null;

  const member = membersByEph.get(ephAddr);

  // ── DM path ───────────────────────────────────────────────────────────────
  if (body.dmTo) {
    // Sender must be a registered member (we need their bound wallet to verify
    // the dm channel id and to drive ECDH from the viewer's side).
    if (!member) return null;
    let dmTo: Address;
    try {
      dmTo = getAddress(body.dmTo);
    } catch {
      return null;
    }
    const expectedChannel = dmChannelId(member.wallet, dmTo);
    if (BigInt(body.channelId) !== expectedChannel) return null;

    // Read access: viewer must be one of the two parties.
    if (!viewer) return null;
    const viewerIsSender =
      viewer.wallet.toLowerCase() === member.wallet.toLowerCase();
    const viewerIsRecipient = viewer.wallet.toLowerCase() === dmTo.toLowerCase();
    if (!viewerIsSender && !viewerIsRecipient) return null;

    // Other party's eph pub for ECDH.
    const otherWallet = viewerIsSender ? dmTo : member.wallet;
    const other = members.get(otherWallet);
    if (!other) return null; // can't decrypt without the other party's eph pub

    let text: string;
    try {
      const sharedKey = ecdh(viewer.ephPriv, other.ephPubHex);
      const plain = await aesGcmDecrypt(sharedKey, hexToBytes(body.content));
      text = new TextDecoder().decode(plain);
    } catch {
      text = "[unable to decrypt]";
    }

    return {
      chainId,
      channelId: expectedChannel,
      fromWallet: member.wallet,
      fromEphAddr: ephAddr,
      nonce: BigInt(body.nonce),
      ts: env.ts,
      text,
      verified: true, // sender is a registered member by construction
    };
  }

  // ── Plain / chain-encrypted channel path ──────────────────────────────────
  let text = "";
  if (body.contentType === 1) {
    // Encrypted with the chain symmetric key derived from the chain seed.
    // Anyone who joined (i.e. has the seed) can decrypt; outsiders cannot.
    const chainKey = loadChainKey(chainId);
    if (!chainKey) {
      text = "[encrypted — open the chain via an invite to read]";
    } else {
      try {
        const plain = await aesGcmDecrypt(chainKey, hexToBytes(body.content));
        text = new TextDecoder().decode(plain);
      } catch {
        text = "[unable to decrypt]";
      }
    }
  } else if (body.contentType === 0) {
    try {
      const bytes = body.content.slice(2);
      const arr = new Uint8Array(bytes.length / 2);
      for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
      }
      text = new TextDecoder().decode(arr);
    } catch {
      text = "";
    }
  }

  return {
    chainId,
    channelId: BigInt(body.channelId),
    fromWallet: member?.wallet ?? ephAddr,
    fromEphAddr: ephAddr,
    nonce: BigInt(body.nonce),
    ts: env.ts,
    text,
    verified: !!member,
  };
}

async function verifySettings(
  env: ChainEnvelope,
  chainId: bigint,
  expectedCreator: Address,
): Promise<{
  nonce: bigint;
  description: string;
  discoverable: boolean;
  inviteMode: InviteMode;
  customChannels: CustomChannelDef[];
} | null> {
  type SettingsBody = {
    chainId: string;
    creator: string;
    nonce: string;
    description: string;
    discoverable: boolean;
    inviteMode: string;
    channelsJson?: string;
    sig: Hex;
  };
  const body = decode<SettingsBody>(env.body);
  if (!body) return null;
  if (BigInt(body.chainId) !== chainId) return null;
  let claimedCreator: Address;
  try {
    claimedCreator = getAddress(body.creator);
  } catch {
    return null;
  }
  if (claimedCreator.toLowerCase() !== expectedCreator.toLowerCase()) return null;

  const description = body.description ?? "";
  const discoverable = body.discoverable ?? true;
  const inviteMode: InviteMode =
    body.inviteMode === "creator-only" || body.inviteMode === "member-approved"
      ? body.inviteMode
      : "open";
  const channelsJson = body.channelsJson ?? "";
  let signer: Address;
  try {
    signer = await recoverSettingsSigner(
      {
        chainId,
        creator: claimedCreator,
        nonce: BigInt(body.nonce),
        description,
        discoverable,
        inviteMode,
        channelsJson,
      },
      body.sig,
    );
  } catch {
    return null;
  }
  if (signer.toLowerCase() !== expectedCreator.toLowerCase()) return null;
  return {
    nonce: BigInt(body.nonce),
    description,
    discoverable,
    inviteMode,
    customChannels: parseCustomChannels(channelsJson),
  };
}

async function verifyPoll(
  env: ChainEnvelope,
  chainId: bigint,
  membersByEph: Map<Address, MemberRecord>,
): Promise<{
  pollId: string;
  question: string;
  options: string[];
  deadline: bigint;
  creatorWallet: Address;
  ts: number;
} | null> {
  type PollBody = {
    chainId: string;
    pollId: string;
    ephAddr: string;
    question: string;
    options: string[];
    deadline: string;
    nonce: string;
    sig: Hex;
  };
  const body = decode<PollBody>(env.body);
  if (!body) return null;
  if (BigInt(body.chainId) !== chainId) return null;
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 10) {
    return null;
  }
  let ephAddr: Address;
  try {
    ephAddr = getAddress(body.ephAddr);
  } catch {
    return null;
  }
  const member = membersByEph.get(ephAddr);
  if (!member) return null; // only registered members can create polls

  const digest = pollDigest({
    chainId,
    pollId: body.pollId,
    question: body.question,
    options: body.options,
    deadline: BigInt(body.deadline),
    nonce: BigInt(body.nonce),
  });
  let signer: Address;
  try {
    signer = await recoverAddress({ hash: digest, signature: body.sig });
  } catch {
    return null;
  }
  if (signer.toLowerCase() !== ephAddr.toLowerCase()) return null;

  return {
    pollId: body.pollId,
    question: body.question,
    options: body.options,
    deadline: BigInt(body.deadline),
    creatorWallet: member.wallet,
    ts: env.ts,
  };
}

async function verifyVote(
  env: ChainEnvelope,
  chainId: bigint,
  membersByEph: Map<Address, MemberRecord>,
): Promise<{ pollId: string; optionIdx: number; voterWallet: Address; nonce: bigint } | null> {
  type VoteBody = {
    chainId: string;
    pollId: string;
    ephAddr: string;
    optionIdx: number;
    nonce: string;
    sig: Hex;
  };
  const body = decode<VoteBody>(env.body);
  if (!body) return null;
  if (BigInt(body.chainId) !== chainId) return null;
  let ephAddr: Address;
  try {
    ephAddr = getAddress(body.ephAddr);
  } catch {
    return null;
  }
  const member = membersByEph.get(ephAddr);
  if (!member) return null; // only registered members can vote

  const digest = voteDigest({
    chainId,
    pollId: body.pollId,
    optionIdx: body.optionIdx,
    nonce: BigInt(body.nonce),
  });
  let signer: Address;
  try {
    signer = await recoverAddress({ hash: digest, signature: body.sig });
  } catch {
    return null;
  }
  if (signer.toLowerCase() !== ephAddr.toLowerCase()) return null;
  if (typeof body.optionIdx !== "number" || body.optionIdx < 0) return null;

  return {
    pollId: body.pollId,
    optionIdx: body.optionIdx,
    voterWallet: member.wallet,
    nonce: BigInt(body.nonce),
  };
}

async function verifyTransfer(
  env: ChainEnvelope,
  chainId: bigint,
): Promise<SignedTransfer | null> {
  type TBody = {
    chainId: string;
    from: string;
    to: string;
    amount: string;
    nonce: string;
    sig: Hex;
  };
  const body = decode<TBody>(env.body);
  if (!body) return null;
  let from: Address;
  let to: Address;
  try {
    from = getAddress(body.from);
    to = getAddress(body.to);
  } catch {
    return null;
  }
  if (BigInt(body.chainId) !== chainId) return null;
  const t: TransferMessage = {
    chainId,
    from,
    to,
    amount: BigInt(body.amount),
    nonce: BigInt(body.nonce),
  };
  const signer = await recoverTransferSigner(t, body.sig);
  if (signer.toLowerCase() !== from.toLowerCase()) return null;
  return { ...t, sig: body.sig };
}

export async function replay(
  chainId: bigint,
  onchainEvents: OnchainEvent[],
  wakuMessages: ChainEnvelope[],
  viewer: ViewerCtx | null = null,
  /** Chain creator (from on-chain `chains[id].creator`). When provided,
   *  Settings envelopes signed by that address are accepted. */
  creator: Address | null = null,
): Promise<ReplayResult> {
  // 0. Settings — pick latest valid envelope by nonce, signed by on-chain creator.
  const settings: ChainSettings = {};
  if (creator) {
    let bestNonce = 0n;
    for (const env of wakuMessages) {
      if (env.type !== "settings") continue;
      const s = await verifySettings(env, chainId, creator);
      if (!s) continue;
      if (s.nonce <= bestNonce) continue;
      bestNonce = s.nonce;
      settings.description = s.description;
      settings.discoverable = s.discoverable;
      settings.inviteMode = s.inviteMode;
      settings.customChannels = s.customChannels;
    }
  }
  const inviteMode: InviteMode = settings.inviteMode ?? "open";

  // Build per-channel write policy table for the chat phase below.
  const verifiedWriteChannels = new Set<string>([CHANNEL_VERIFIED.toString()]);
  const creatorWriteChannels = new Set<string>();
  for (const ch of settings.customChannels ?? []) {
    const cid = customChannelId(ch.name).toString();
    if (ch.write === "verified") verifiedWriteChannels.add(cid);
    if (ch.write === "creator") {
      creatorWriteChannels.add(cid);
      // Creator-write also implies verified-write semantically (creator must
      // be registered, which means verified). We add it here so anyone non-
      // creator gets dropped before we even reach the verified check.
      verifiedWriteChannels.add(cid);
    }
  }

  // 1. Members from Waku Register messages, gated by chain invite policy.
  //    First collect every cryptographically valid candidate, then accept
  //    them based on inviteMode + on-chain creator + (for member-approved)
  //    iterative reachability from the creator.
  const candidates: RegisterCandidate[] = [];
  for (const env of wakuMessages) {
    if (env.type !== "register") continue;
    const c = await verifyRegister(env, chainId);
    if (c) candidates.push(c);
  }
  candidates.sort((a, b) => a.ts - b.ts);

  const members = new Map<Address, MemberRecord>();
  const membersByEph = new Map<Address, MemberRecord>();
  const accept = (m: MemberRecord) => {
    if (members.has(m.wallet)) return;
    members.set(m.wallet, m);
    membersByEph.set(m.ephAddr, m);
  };

  if (!creator || inviteMode === "open") {
    // Legacy open mode: any candidate with a valid sig is accepted.
    for (const c of candidates) accept(c.member);
  } else if (inviteMode === "creator-only") {
    for (const c of candidates) {
      if (c.member.wallet.toLowerCase() === creator.toLowerCase()) {
        accept(c.member);
      } else if (
        c.inviter &&
        c.inviter.toLowerCase() === creator.toLowerCase()
      ) {
        accept(c.member);
      }
    }
  } else {
    // member-approved: creator first, then iteratively accept candidates whose
    // inviter is already in the accepted set.
    for (const c of candidates) {
      if (c.member.wallet.toLowerCase() === creator.toLowerCase()) {
        accept(c.member);
      }
    }
    let added = true;
    while (added) {
      added = false;
      for (const c of candidates) {
        if (members.has(c.member.wallet)) continue;
        if (!c.inviter) continue;
        if (members.has(c.inviter)) {
          accept(c.member);
          added = true;
        }
      }
    }
  }

  // 2. Onchain balances and lastNonce — order by (block, logIndex)
  const onchainBalance = new Map<Address, bigint>();
  const lastNonceOnchain = new Map<Address, bigint>();
  const sortedOnchain = [...onchainEvents].sort(
    (a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : Number(a.blockNumber - b.blockNumber),
  );
  for (const ev of sortedOnchain) {
    if (ev.data.kind === "Deposited") {
      inc(onchainBalance, ev.data.from, ev.data.amount);
    } else if (ev.data.kind === "Withdrawn") {
      inc(onchainBalance, ev.data.to, -ev.data.amount);
    } else if (ev.data.kind === "TransferApplied") {
      inc(onchainBalance, ev.data.from, -ev.data.amount);
      inc(onchainBalance, ev.data.to, ev.data.amount);
      const cur = lastNonceOnchain.get(ev.data.from) ?? 0n;
      if (ev.data.nonce > cur) lastNonceOnchain.set(ev.data.from, ev.data.nonce);
    }
  }

  // 3. Pending transfers from Waku
  const allTransfers: SignedTransfer[] = [];
  for (const env of wakuMessages) {
    if (env.type !== "transfer") continue;
    const t = await verifyTransfer(env, chainId);
    if (!t) continue;
    allTransfers.push(t);
  }
  // Filter to ones not already on-chain (nonce > lastNonceOnchain[from]).
  // Sort by (from asc, nonce asc) — required submit order for applyTransfers.
  const pendingTransfers = allTransfers
    .filter((t) => t.nonce > (lastNonceOnchain.get(t.from) ?? 0n))
    .sort((a, b) => {
      if (a.from === b.from) return a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0;
      return a.from < b.from ? -1 : 1;
    });

  // Dedupe by (from, nonce)
  const seen = new Set<string>();
  const dedupedPending: SignedTransfer[] = [];
  for (const t of pendingTransfers) {
    const k = `${t.from}:${t.nonce.toString()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedPending.push(t);
  }

  // 4. Pending delta + effective balance
  const pendingDelta = new Map<Address, bigint>();
  for (const t of dedupedPending) {
    inc(pendingDelta, t.from, -t.amount);
    inc(pendingDelta, t.to, t.amount);
  }
  const effectiveBalance = new Map<Address, bigint>();
  const allWallets = new Set<Address>([
    ...onchainBalance.keys(),
    ...pendingDelta.keys(),
    ...members.keys(),
  ]);
  for (const w of allWallets) {
    effectiveBalance.set(w, (onchainBalance.get(w) ?? 0n) + (pendingDelta.get(w) ?? 0n));
  }

  // 5. Polls + votes — pure tally over signed envelopes.
  const polls = new Map<string, PollRecord>();
  for (const env of wakuMessages) {
    if (env.type !== "poll") continue;
    const p = await verifyPoll(env, chainId, membersByEph);
    if (!p) continue;
    if (polls.has(p.pollId)) continue; // first poll envelope wins per id
    polls.set(p.pollId, {
      chainId,
      pollId: p.pollId,
      question: p.question,
      options: p.options,
      deadline: p.deadline,
      creatorWallet: p.creatorWallet,
      ts: p.ts,
      votes: new Map(),
      tally: new Array(p.options.length).fill(0),
      latestVoteNonce: new Map(),
    });
  }
  for (const env of wakuMessages) {
    if (env.type !== "vote") continue;
    const v = await verifyVote(env, chainId, membersByEph);
    if (!v) continue;
    const poll = polls.get(v.pollId);
    if (!poll) continue;
    if (v.optionIdx >= poll.options.length) continue;
    // Reject votes after the poll deadline
    if (poll.deadline !== 0n && BigInt(env.ts) > poll.deadline * 1000n) continue;
    // Last vote (by nonce) per voter wins
    const prevNonce = poll.latestVoteNonce.get(v.voterWallet);
    if (prevNonce !== undefined && v.nonce <= prevNonce) continue;
    poll.latestVoteNonce.set(v.voterWallet, v.nonce);
    poll.votes.set(v.voterWallet, v.optionIdx);
  }
  for (const poll of polls.values()) {
    poll.tally = new Array(poll.options.length).fill(0);
    for (const idx of poll.votes.values()) {
      if (idx < poll.tally.length) poll.tally[idx]++;
    }
  }

  // 6. Channels — group + sort chats by ts asc; dedupe by (ephAddr, nonce).
  // Per-channel write policy is enforced here using the table built from
  // settings above (defaults + custom channels).
  const channels = new Map<string, ChatRecord[]>();
  const seenChat = new Set<string>();
  for (const env of wakuMessages) {
    if (env.type !== "chat") continue;
    const c = await verifyChat(env, chainId, members, membersByEph, viewer);
    if (!c) continue;
    const channelKey = c.channelId.toString();
    if (!isDmChannelId(c.channelId)) {
      if (verifiedWriteChannels.has(channelKey) && !c.verified) continue;
      if (
        creatorWriteChannels.has(channelKey) &&
        creator &&
        c.fromWallet.toLowerCase() !== creator.toLowerCase()
      )
        continue;
    }
    const dedupeKey = `${channelKey}:${c.fromEphAddr}:${c.nonce.toString()}`;
    if (seenChat.has(dedupeKey)) continue;
    seenChat.add(dedupeKey);
    const list = channels.get(channelKey) ?? [];
    list.push(c);
    channels.set(channelKey, list);
  }
  for (const list of channels.values()) {
    list.sort((a, b) => (a.ts === b.ts ? Number(a.nonce - b.nonce) : a.ts - b.ts));
  }

  // Touch unused import for tree-shaking-resistance.
  void joinProofDigest;

  return {
    chainId,
    members,
    membersByEph,
    channels,
    polls,
    settings,
    onchainBalance,
    lastNonceOnchain,
    pendingTransfers: dedupedPending,
    pendingDelta,
    effectiveBalance,
  };
}
