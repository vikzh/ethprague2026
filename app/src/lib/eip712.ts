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
  ],
} as const;

export interface SettingsMessage {
  chainId: bigint;
  creator: Address;
  nonce: bigint;
  description: string;
  discoverable: boolean;
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
