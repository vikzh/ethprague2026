"use client";

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  type Address,
  type Hex,
  bytesToHex,
  hexToBytes,
} from "viem";
import type { WalletClient } from "viem";
import { saveChainSeed } from "./chainKey";
import { upsertLocalChain } from "./chainsLocal";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto";
import { EIP712_DOMAIN } from "./eip712";
import { saveEphKey, ephKeyFromPrivHex } from "./ephemeral";
import type { ChainEnvelope } from "./waku";

/**
 * Encrypted on-disk backup of a chain's state. Decryptable only by the same
 * wallet that signed the export (we derive the AES key from a deterministic
 * EIP-712 signature over the chain id + a fixed action tag).
 *
 * Schema is intentionally tiny and self-describing so future versions can
 * upgrade without breaking restore.
 */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FILENAME = (chainId: string) =>
  `pocketchain-${chainId}.backup.json`;

export interface BackupBlob {
  schema: number;
  chainId: string;
  /** EIP-712 typed-data domain so a verifier knows where the sig came from. */
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  signer: Address; // wallet that signed (and can decrypt)
  iv: Hex;
  ciphertext: Hex; // AES-GCM(iv || ciphertext+tag) of plaintext JSON payload
  signature: Hex; // the signature whose hash was used as the AES key
}

export const BACKUP_TYPES = {
  PocketChainsBackup: [
    { name: "chainId", type: "uint256" },
    { name: "action", type: "string" },
  ],
} as const;

function buildBackupKeyMessage(chainId: bigint) {
  return { chainId, action: "backup" };
}

/** Ask the wallet to sign the deterministic backup message; hash the sig to a 32-byte key. */
async function deriveBackupKey(
  walletClient: WalletClient,
  account: Address,
  chainId: bigint,
): Promise<{ key: Uint8Array; signature: Hex }> {
  const signature = (await walletClient.signTypedData({
    account,
    domain: EIP712_DOMAIN,
    types: BACKUP_TYPES,
    primaryType: "PocketChainsBackup",
    message: buildBackupKeyMessage(chainId),
  })) as Hex;
  const key = keccak_256(hexToBytes(signature));
  return { key, signature };
}

export async function exportChainBackup(args: {
  walletClient: WalletClient;
  account: Address;
  chainId: bigint;
  payload: unknown;
}): Promise<BackupBlob> {
  const { walletClient, account, chainId, payload } = args;
  const { key, signature } = await deriveBackupKey(walletClient, account, chainId);
  const plaintext = new TextEncoder().encode(
    JSON.stringify(payload, (_k, v) =>
      typeof v === "bigint" ? `0x${v.toString(16)}n` : v,
    ),
  );
  const combined = await aesGcmEncrypt(key, plaintext);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  return {
    schema: BACKUP_SCHEMA_VERSION,
    chainId: chainId.toString(),
    domain: { ...EIP712_DOMAIN },
    signer: account,
    iv: ("0x" + bytesToHex(iv).replace(/^0x/, "")) as Hex,
    ciphertext: ("0x" + bytesToHex(ct).replace(/^0x/, "")) as Hex,
    signature,
  };
}

export async function importChainBackup(args: {
  walletClient: WalletClient;
  account: Address;
  blob: BackupBlob;
}): Promise<unknown> {
  const { walletClient, account, blob } = args;
  if (blob.schema !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`unsupported backup schema ${blob.schema}`);
  }
  if (blob.signer.toLowerCase() !== account.toLowerCase()) {
    throw new Error("connected wallet doesn't match backup signer");
  }
  const { key } = await deriveBackupKey(walletClient, account, BigInt(blob.chainId));
  const combined = new Uint8Array(12 + (blob.ciphertext.length / 2 - 1));
  combined.set(hexToBytes(blob.iv), 0);
  combined.set(hexToBytes(blob.ciphertext), 12);
  const plain = await aesGcmDecrypt(key, combined);
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text, (_k, v) => {
    if (typeof v === "string" && /^0x[0-9a-f]+n$/.test(v)) {
      return BigInt(v.slice(0, -1));
    }
    return v;
  });
}

/** Trigger a browser file download for the given JSON-serialisable blob. */
export function downloadJSON(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Restored-envelope buffer ────────────────────────────────────────────────
// When a user imports a backup we stash the raw Waku envelopes here, keyed by
// chain id. useChainState ingests them on mount so the chain page renders the
// historical chat immediately without depending on Waku store.

function restoredKey(chainId: string): string {
  return `pc_restored:${chainId}`;
}

export function saveRestoredEnvelopes(
  chainId: string,
  envelopes: ChainEnvelope[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(restoredKey(chainId), JSON.stringify(envelopes));
  } catch {
    // ignore quota errors
  }
}

export function loadRestoredEnvelopes(chainId: string): ChainEnvelope[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(restoredKey(chainId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChainEnvelope[]) : [];
  } catch {
    return [];
  }
}

/** Drop the one-shot restored-envelope buffer for a chain. Called after
 *  successful ingest, and also when we detect the chain no longer exists on
 *  the current contract (so stale data doesn't leak into a future chain
 *  that happens to reuse the same id). */
export function clearRestoredEnvelopes(chainId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(restoredKey(chainId));
  } catch {
    // ignore
  }
}

// ─── Backup payload shape + restore orchestration ────────────────────────────

export interface BackupPayload {
  exportedAt: string;
  chainId: string;
  /** Local-only friendly label, if the exporter set one. */
  name?: string;
  /** Chain seed privkey — recovers chain symmetric key for chat decryption. */
  seedHex?: Hex;
  /** Owner's ephemeral chat key — recovers DM ECDH and Register identity. */
  ephPrivHex?: Hex;
  /** Whoever the exporter saw as members (eph pub keys for DM ECDH). */
  members?: { wallet: Address; ephAddr: Address; ephPubHex: Hex }[];
  /** Full Waku envelope log seen by the exporter. */
  envelopes: ChainEnvelope[];
}

/**
 * Apply a decrypted backup payload to localStorage so opening
 * `/chain/<id>` shows the restored chat + balances immediately.
 *
 * Returns the chainId so the caller can navigate.
 */
export function restoreFromPayload(
  payload: BackupPayload,
  walletAddress: Address,
): { chainId: string } {
  const chainId = payload.chainId;
  const cidBig = BigInt(chainId);

  if (payload.seedHex) {
    saveChainSeed(cidBig, payload.seedHex);
  }
  if (payload.ephPrivHex) {
    try {
      const eph = ephKeyFromPrivHex(payload.ephPrivHex);
      saveEphKey(cidBig, walletAddress, eph);
    } catch {
      // ignore — chain key still recoverable from seed; user may need to
      // re-publish Register so other members see this restored identity.
    }
  }

  upsertLocalChain({
    id: chainId,
    name: payload.name?.trim() ?? "",
    role: "member", // can't tell from backup alone; user can rename if needed
  });

  if (Array.isArray(payload.envelopes) && payload.envelopes.length > 0) {
    saveRestoredEnvelopes(chainId, payload.envelopes);
  }

  return { chainId };
}
