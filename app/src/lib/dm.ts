"use client";

import { type Address, encodeAbiParameters, getAddress, keccak256 } from "viem";

/**
 * Deterministic channel id for a 1:1 DM between two wallets. Symmetric: both
 * parties compute the same value regardless of order.
 *
 * We OR a high bit so it can never collide with the small public/verified
 * channel ids (0, 1, …).
 */
export function dmChannelId(a: Address, b: Address): bigint {
  const aChk = getAddress(a);
  const bChk = getAddress(b);
  const [lo, hi] =
    aChk.toLowerCase() < bChk.toLowerCase() ? [aChk, bChk] : [bChk, aChk];
  const hash = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "address" }], [lo, hi]),
  );
  return BigInt(hash) | (1n << 255n);
}

/** True if a channelId looks like a DM channel (high bit set). */
export function isDmChannelId(id: bigint): boolean {
  return (id & (1n << 255n)) !== 0n;
}
