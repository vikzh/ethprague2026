import {
  type Address,
  type Hex,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  recoverAddress,
  recoverTypedDataAddress,
} from "viem";
import { CHAINPOOL_ADDRESS, TARGET_CHAIN_ID } from "./contract";

export const EIP712_DOMAIN = {
  name: "PocketChains",
  version: "1",
  chainId: TARGET_CHAIN_ID,
  verifyingContract: CHAINPOOL_ADDRESS,
} as const;

export const TRANSFER_TYPES = {
  Transfer: [
    { name: "chainId", type: "uint256" },
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export const REGISTER_TYPES = {
  Register: [
    { name: "chainId", type: "uint256" },
    { name: "wallet", type: "address" },
    { name: "ephAddr", type: "address" },
    { name: "ephPubHash", type: "bytes32" },
  ],
} as const;

export interface RegisterMessage {
  chainId: bigint;
  wallet: Address;
  ephAddr: Address;
  ephPubHash: Hex;
}

/**
 * Chain-level "soft policy" settings published by the creator. Replay accepts
 * the latest envelope signed by the on-chain `creator` address. Schema is
 * intentionally fixed-shape so EIP-712 popups in the wallet are readable —
 * adding new fields is a typehash bump (acceptable for v0).
 */
export const SETTINGS_TYPES = {
  Settings: [
    { name: "chainId", type: "uint256" },
    { name: "creator", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "description", type: "string" },
    { name: "discoverable", type: "bool" },
    { name: "inviteMode", type: "string" },
    /** Compact JSON of the creator-defined custom channel list, e.g.
     *  `[{"name":"core","write":"verified"}]`. Kept as a string so the EIP-712
     *  typehash stays stable as the inner shape evolves. Default channels
     *  (#public, #verified) are not included here. */
    { name: "channelsJson", type: "string" },
    /** Poll-tally consensus mode used by the replay engine when rendering
     *  poll results. "one-member-one-vote" = each registered member's vote
     *  counts equally. "stake-weighted" = each voter's contribution to the
     *  tally is their current on-chain pool balance (PoS-style). */
    { name: "pollMode", type: "string" },
  ],
} as const;

export type InviteMode = "open" | "creator-only" | "member-approved";

export type PollMode = "one-member-one-vote" | "stake-weighted";

export type ChannelWritePolicy = "anyone" | "verified" | "creator";

export interface CustomChannelDef {
  name: string;
  write: ChannelWritePolicy;
}

export interface SettingsMessage {
  chainId: bigint;
  creator: Address;
  nonce: bigint;
  description: string;
  discoverable: boolean;
  inviteMode: InviteMode;
  channelsJson: string;
  pollMode: PollMode;
}

/** Compact, deterministic serializer used both at sign-time and verify-time so
 *  the EIP-712 digest matches across clients. */
export function serializeCustomChannels(channels: CustomChannelDef[]): string {
  if (!channels.length) return "";
  // Strip whitespace and lower-case names so equivalent inputs produce the
  // same canonical JSON. Drop empty names. Preserve declaration order.
  const cleaned = channels
    .map((c) => ({
      name: c.name.trim().toLowerCase(),
      write: c.write,
    }))
    .filter((c) => c.name.length > 0);
  if (!cleaned.length) return "";
  return JSON.stringify(cleaned);
}

export function parseCustomChannels(json: string): CustomChannelDef[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: CustomChannelDef[] = [];
    for (const item of arr) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { name: unknown }).name === "string" &&
        ((item as { write: unknown }).write === "anyone" ||
          (item as { write: unknown }).write === "verified" ||
          (item as { write: unknown }).write === "creator")
      ) {
        const name = ((item as { name: string }).name).trim().toLowerCase();
        if (!name) continue;
        out.push({
          name,
          write: (item as { write: ChannelWritePolicy }).write,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Wallet-signed invite carried alongside the chain seed in the invite URL.
 *  Verified by replay when the chain's invite policy isn't "open". */
export const INVITE_TYPES = {
  Invite: [
    { name: "chainId", type: "uint256" },
    { name: "inviter", type: "address" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface InviteMessage {
  chainId: bigint;
  inviter: Address;
  expiresAt: bigint;
  nonce: bigint;
}

export async function recoverInviteSigner(
  msg: InviteMessage,
  sig: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: EIP712_DOMAIN,
    types: INVITE_TYPES,
    primaryType: "Invite",
    message: msg,
    signature: sig,
  });
}

export async function recoverSettingsSigner(
  msg: SettingsMessage,
  sig: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: EIP712_DOMAIN,
    types: SETTINGS_TYPES,
    primaryType: "Settings",
    message: msg,
    signature: sig,
  });
}

export interface TransferMessage {
  chainId: bigint;
  from: Address;
  to: Address;
  amount: bigint;
  nonce: bigint;
}

export interface SignedTransfer extends TransferMessage {
  sig: Hex;
}

export async function recoverTransferSigner(t: TransferMessage, sig: Hex): Promise<Address> {
  const { hashTypedData } = await import("viem");
  const digest = hashTypedData({
    domain: EIP712_DOMAIN,
    types: TRANSFER_TYPES,
    primaryType: "Transfer",
    message: {
      chainId: t.chainId,
      from: t.from,
      to: t.to,
      amount: t.amount,
      nonce: t.nonce,
    },
  });
  return recoverAddress({ hash: digest, signature: sig });
}

// JoinProof: signed by the seed ephemeral private key. Just an ethereum-style ECDSA
// signature over keccak256("PocketChains:JoinProof:v1" || chainId || joiner).
export function joinProofDigest(chainId: bigint, joiner: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
      ],
      ["PocketChains:JoinProof:v1", chainId, joiner],
    ),
  );
}

/** Build the canonical Register message (EIP-712 typed data fields). */
export function buildRegisterMessage(input: {
  chainId: bigint;
  wallet: Address;
  ephAddr: Address;
  ephPubHex: Hex;
}): RegisterMessage {
  return {
    chainId: input.chainId,
    wallet: input.wallet,
    ephAddr: input.ephAddr,
    ephPubHash: keccak256(input.ephPubHex),
  };
}

/** Recover the wallet that signed a Register typed-data message. */
export async function recoverRegisterSigner(
  msg: RegisterMessage,
  sig: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: EIP712_DOMAIN,
    types: REGISTER_TYPES,
    primaryType: "Register",
    message: msg,
    signature: sig,
  });
}

export function chatDigest(input: {
  chainId: bigint;
  channelId: bigint;
  nonce: bigint;
  timestamp: bigint;
  contentType: number;
  content: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint8" },
        { type: "bytes" },
      ],
      [
        "PocketChains:Chat:v1",
        input.chainId,
        input.channelId,
        input.nonce,
        input.timestamp,
        input.contentType,
        input.content,
      ],
    ),
  );
}

/** A poll's content commitment (question + options + deadline) signed by the
 *  creator's chat eph key. */
export function pollDigest(input: {
  chainId: bigint;
  pollId: string;
  question: string;
  options: string[];
  deadline: bigint;
  nonce: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "string" },
        { type: "string" },
        { type: "string[]" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [
        "PocketChains:Poll:v1",
        input.chainId,
        input.pollId,
        input.question,
        input.options,
        input.deadline,
        input.nonce,
      ],
    ),
  );
}

/** A vote on a poll, signed by the voter's chat eph key. */
export function voteDigest(input: {
  chainId: bigint;
  pollId: string;
  optionIdx: number;
  nonce: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "string" },
        { type: "uint8" },
        { type: "uint64" },
      ],
      [
        "PocketChains:Vote:v1",
        input.chainId,
        input.pollId,
        input.optionIdx,
        input.nonce,
      ],
    ),
  );
}

// Helper: convert hex sig to bytes for any verifier that wants raw.
export function sigBytes(sig: Hex): Uint8Array {
  return hexToBytes(sig);
}
