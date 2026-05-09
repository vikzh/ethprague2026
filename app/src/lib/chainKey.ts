"use client";

import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes, type Hex } from "viem";

/**
 * Symmetric key shared by all members of a chain. Derived deterministically
 * from the chain's seed private key (which lives in the invite-link fragment
 * and is persisted locally for both the creator and every joiner).
 *
 * Anyone with the seed can derive this key; outside observers cannot. Used
 * to AES-GCM-encrypt all non-DM chat messages so a Waku eavesdropper sees
 * only ciphertext.
 */
export function deriveChainKey(seedPrivHex: Hex): Uint8Array {
  const tag = new TextEncoder().encode("PocketChains:ChainKey:v1");
  const priv = hexToBytes(seedPrivHex);
  const buf = new Uint8Array(tag.length + priv.length);
  buf.set(tag, 0);
  buf.set(priv, tag.length);
  return keccak_256(buf);
}

const SEED_KEY_PREFIX = "pc_seed";

export function loadChainSeed(chainId: bigint): Hex | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(`${SEED_KEY_PREFIX}:${chainId.toString()}`);
  return v ? (v as Hex) : null;
}

export function saveChainSeed(chainId: bigint, seedPrivHex: Hex): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${SEED_KEY_PREFIX}:${chainId.toString()}`, seedPrivHex);
}

export function loadChainKey(chainId: bigint): Uint8Array | null {
  const seed = loadChainSeed(chainId);
  if (!seed) return null;
  return deriveChainKey(seed);
}
