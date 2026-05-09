import * as secp from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface EphKey {
  privHex: Hex;
  pubHex: Hex; // uncompressed (0x04 || X || Y), 65 bytes
  address: Address;
}

function ensureHex(v: string): Hex {
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
}

export function generateEphKey(): EphKey {
  const priv = secp.utils.randomSecretKey();
  const privHex = ensureHex(bytesToHex(priv));
  const pub = secp.getPublicKey(priv, false); // uncompressed
  return {
    privHex,
    pubHex: ensureHex(bytesToHex(pub)),
    address: privateKeyToAccount(privHex).address,
  };
}

export function ephKeyFromPrivHex(privHex: Hex): EphKey {
  const priv = hexToBytes(privHex);
  const pub = secp.getPublicKey(priv, false);
  return {
    privHex,
    pubHex: ensureHex(bytesToHex(pub)),
    address: privateKeyToAccount(privHex).address,
  };
}

export function ephAddressFromPubHex(pubHex: Hex): Address {
  // keccak256 of the uncompressed pub minus the 0x04 prefix, last 20 bytes.
  const bytes = hexToBytes(pubHex);
  const xy = bytes.slice(1);
  const hash = keccak_256(xy);
  return ensureHex(bytesToHex(hash.slice(-20))) as Address;
}

/**
 * Sign an arbitrary 32-byte digest with an ephemeral key. Uses viem's account
 * signer, which produces a 65-byte sig (r || s || v) recoverable via
 * `recoverAddress({ hash: digest, signature })`. v in {27, 28}.
 */
export async function signDigest(privHex: Hex, digest: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privHex);
  return account.sign({ hash: digest });
}

/** ECDH between two keypairs. Returns 32 bytes derived from shared point x-coord. */
export function ecdh(myPrivHex: Hex, theirPubHex: Hex): Uint8Array {
  const shared = secp.getSharedSecret(hexToBytes(myPrivHex), hexToBytes(theirPubHex), true);
  return keccak_256(shared.slice(1));
}

const STORAGE_PREFIX = "pc_eph";

function storageKey(chainId: bigint, wallet: Address): string {
  return `${STORAGE_PREFIX}:${chainId.toString()}:${wallet.toLowerCase()}`;
}

export function loadOrCreateEphKey(chainId: bigint, wallet: Address): EphKey {
  if (typeof window === "undefined") {
    return generateEphKey();
  }
  const k = storageKey(chainId, wallet);
  const existing = window.localStorage.getItem(k);
  if (existing) {
    try {
      return ephKeyFromPrivHex(existing as Hex);
    } catch {
      // regenerate
    }
  }
  const created = generateEphKey();
  window.localStorage.setItem(k, created.privHex);
  return created;
}

export function saveEphKey(chainId: bigint, wallet: Address, eph: EphKey): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(chainId, wallet), eph.privHex);
}

export function loadEphKey(chainId: bigint, wallet: Address): EphKey | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(storageKey(chainId, wallet));
  if (!v) return null;
  try {
    return ephKeyFromPrivHex(v as Hex);
  } catch {
    return null;
  }
}
