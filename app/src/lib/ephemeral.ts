import * as secp from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

export interface EphKey {
  privHex: Hex;
  pubHex: Hex; // uncompressed (0x04 || X || Y), 65 bytes
  address: Address;
}

function addressFromPub(pubBytes: Uint8Array): Address {
  const xy = pubBytes.slice(1);
  const hash = keccak_256(xy);
  return ("0x" + bytesToHex(hash.slice(-20)).slice(2)) as Address;
}

export function generateEphKey(): EphKey {
  const priv = secp.utils.randomSecretKey();
  const pub = secp.getPublicKey(priv, false); // uncompressed
  return {
    privHex: bytesToHex(priv) as Hex,
    pubHex: bytesToHex(pub) as Hex,
    address: addressFromPub(pub),
  };
}

export function ephKeyFromPrivHex(privHex: Hex): EphKey {
  const priv = hexToBytes(privHex);
  const pub = secp.getPublicKey(priv, false);
  return {
    privHex,
    pubHex: bytesToHex(pub) as Hex,
    address: addressFromPub(pub),
  };
}

export function ephAddressFromPubHex(pubHex: Hex): Address {
  return addressFromPub(hexToBytes(pubHex));
}

/**
 * Sign an arbitrary 32-byte digest with an ephemeral key. Returns a 65-byte hex
 * signature (r || s || v) compatible with viem's `recoverAddress` and OpenZeppelin
 * `ECDSA.recover` — i.e. v in {27, 28}.
 */
export async function signDigest(privHex: Hex, digest: Hex): Promise<Hex> {
  const priv = hexToBytes(privHex);
  const msg = hexToBytes(digest);
  // recovered format = compact(64) + recovery byte(1)
  const recovered = await secp.signAsync(msg, priv, {
    format: "recovered",
    prehash: false,
  });
  const sig64 = recovered.slice(0, 64);
  const recovery = recovered[64]!;
  const v = recovery === 0 ? 27 : 28;
  const out = new Uint8Array(65);
  out.set(sig64, 0);
  out[64] = v;
  return ("0x" + bytesToHex(out).replace(/^0x/, "")) as Hex;
}

/** ECDH between two keypairs. Returns 32 bytes derived from shared point x-coord. */
export function ecdh(myPrivHex: Hex, theirPubHex: Hex): Uint8Array {
  const shared = secp.getSharedSecret(hexToBytes(myPrivHex), hexToBytes(theirPubHex), true);
  // shared is compressed pub-style (33 bytes); use the X coord and hash for symmetry
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
