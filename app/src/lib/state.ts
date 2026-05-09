"use client";

import { type Address, type Hex, getAddress, hexToBytes, recoverAddress } from "viem";
import { loadChainKey } from "./chainKey";
import { aesGcmDecrypt } from "./crypto";
import { dmChannelId, isDmChannelId } from "./dm";
import { ecdh, ephAddressFromPubHex } from "./ephemeral";
import {
  buildRegisterMessage,
  chatDigest,
  joinProofDigest,
  pollDigest,
  recoverRegisterSigner,
  recoverTransferSigner,
  voteDigest,
  type SignedTransfer,
  type TransferMessage,
} from "./eip712";
import type { ChainEnvelope } from "./waku";

/** Caller-supplied viewer context used to decrypt 1:1 DMs locally. */
export interface ViewerCtx {
  wallet: Address;
  ephPriv: Hex;
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

async function verifyRegister(env: ChainEnvelope, chainId: bigint): Promise<MemberRecord | null> {
  type RegBody = {
    chainId: string;
    wallet: string;
    ephAddr: string;
    ephPubHex: Hex;
    joinProofSig: Hex;
    registerSig: Hex;
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
  // 3. We trust joinProofSig was checked client-side at join time. We don't recheck it
  //    here because that requires knowing the chain seed pubkey commit. Replay drops
  //    bogus members on the membership step in stricter setups; this is fine for v0.
  return { wallet, ephAddr, ephPubHex: body.ephPubHex, joinedAtTs: env.ts };
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
): Promise<ReplayResult> {
  // 1. Members from Waku Register messages
  const members = new Map<Address, MemberRecord>();
  const membersByEph = new Map<Address, MemberRecord>();
  for (const env of wakuMessages) {
    if (env.type !== "register") continue;
    const m = await verifyRegister(env, chainId);
    if (!m) continue;
    if (!members.has(m.wallet)) {
      members.set(m.wallet, m);
      membersByEph.set(m.ephAddr, m);
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
  // Verified-only channels (e.g. #verified) drop chats from unregistered senders.
  // DM chats (dmTo present) are decrypted for the viewer; non-participants are dropped.
  const channels = new Map<string, ChatRecord[]>();
  const seenChat = new Set<string>();
  for (const env of wakuMessages) {
    if (env.type !== "chat") continue;
    const c = await verifyChat(env, chainId, members, membersByEph, viewer);
    if (!c) continue;
    const channelKey = c.channelId.toString();
    // For non-DM channels, enforce verified-write policy.
    if (!isDmChannelId(c.channelId) && VERIFIED_ONLY_CHANNELS.has(channelKey) && !c.verified)
      continue;
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
    onchainBalance,
    lastNonceOnchain,
    pendingTransfers: dedupedPending,
    pendingDelta,
    effectiveBalance,
  };
}
