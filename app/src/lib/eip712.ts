import {
  type Address,
  type Hex,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  recoverAddress,
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

// Register message: signed by the wallet, asserts (wallet, ephAddr, ephPub, chainId, joinProof).
// Verified by clients on replay; not used on-chain.
export function registerDigest(input: {
  chainId: bigint;
  wallet: Address;
  ephAddr: Address;
  ephPubHex: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes" },
      ],
      [
        "PocketChains:Register:v1",
        input.chainId,
        input.wallet,
        input.ephAddr,
        input.ephPubHex,
      ],
    ),
  );
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

// Helper: convert hex sig to bytes for any verifier that wants raw.
export function sigBytes(sig: Hex): Uint8Array {
  return hexToBytes(sig);
}
