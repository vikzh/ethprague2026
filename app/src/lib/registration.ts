"use client";

import type { Address, Hex } from "viem";
import type { WalletClient } from "viem";
import { cacheRegisterEnvelope } from "./chainsLocal";
import {
  EIP712_DOMAIN,
  INVITE_TYPES,
  REGISTER_TYPES,
  buildRegisterMessage,
  joinProofDigest,
  type InviteMessage,
} from "./eip712";
import {
  ephKeyFromPrivHex,
  loadOrCreateEphKey,
  signDigest,
  type EphKey,
} from "./ephemeral";
import { envelopeRegister, type ChainEnvelope, type WakuClient } from "./waku";

/** Wallet-signed invite carried in the URL fragment alongside the chain seed.
 *  Required when the chain's invite policy isn't "open". */
export interface WalletInvite {
  inviter: Address;
  expiresAt: bigint; // unix seconds, 0 = no expiry
  nonce: bigint;
  sig: Hex;
}

/** Sign a wallet-bound Invite via EIP-712. Inviter wallet pop-up shows
 *  structured fields. The returned object is portable and can be encoded into
 *  the URL fragment (`?inv=<base64url JSON>`). */
export async function signInvite(args: {
  walletClient: WalletClient;
  account: Address;
  chainId: bigint;
  /** Seconds from now until the invite expires; 0 = no expiry. */
  ttlSeconds?: number;
}): Promise<WalletInvite> {
  const { walletClient, account, chainId, ttlSeconds = 0 } = args;
  const expiresAt =
    ttlSeconds > 0 ? BigInt(Math.floor(Date.now() / 1000) + ttlSeconds) : 0n;
  const nonce = BigInt(Date.now());
  const msg: InviteMessage = { chainId, inviter: account, expiresAt, nonce };
  const sig = (await walletClient.signTypedData({
    account,
    domain: EIP712_DOMAIN,
    types: INVITE_TYPES,
    primaryType: "Invite",
    message: msg,
  })) as Hex;
  return { inviter: account, expiresAt, nonce, sig };
}

/** Compact base64url encoding of a WalletInvite for URL fragments. */
export function encodeInviteForUrl(invite: WalletInvite): string {
  const json = JSON.stringify({
    i: invite.inviter,
    e: invite.expiresAt.toString(),
    n: invite.nonce.toString(),
    s: invite.sig,
  });
  // base64url
  const b64 = typeof window !== "undefined" ? window.btoa(json) : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeInviteFromUrl(encoded: string): WalletInvite | null {
  try {
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json =
      typeof window !== "undefined"
        ? window.atob(b64)
        : Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as {
      i: string;
      e: string;
      n: string;
      s: Hex;
    };
    return {
      inviter: parsed.i as Address,
      expiresAt: BigInt(parsed.e),
      nonce: BigInt(parsed.n),
      sig: parsed.s,
    };
  } catch {
    return null;
  }
}

/**
 * Make sure the connected wallet has a Register message published to the chain's
 * Waku topic. Idempotent — safe to call on every chain-view mount.
 *
 * The Register envelope is also pushed into the local replay buffer (when
 * `addLocalEnvelope` is provided) so the UI flips to "member" immediately,
 * even before Waku peers echo it back.
 */
export async function ensureRegistered(args: {
  chainId: bigint;
  wallet: Address;
  walletClient: WalletClient;
  waku: WakuClient | null;
  isAlreadyMember: boolean;
  seedPrivHex?: Hex | null;
  invitePrivHex?: Hex | null;
  /** Wallet-signed invite to embed in the Register envelope. Required when
   *  the chain's policy is "creator-only" or "member-approved". */
  walletInvite?: WalletInvite | null;
  addLocalEnvelope?: (env: ChainEnvelope) => void;
}): Promise<{ published: boolean; eph: EphKey; envelope?: ChainEnvelope } | null> {
  const { chainId, wallet, walletClient, waku, isAlreadyMember, walletInvite, addLocalEnvelope } = args;
  if (!waku) return null;

  const eph = loadOrCreateEphKey(chainId, wallet);
  if (isAlreadyMember) return { published: false, eph };

  let joinProofSig: Hex = "0x" as Hex;
  const seedHex = args.seedPrivHex ?? args.invitePrivHex ?? null;
  if (seedHex) {
    try {
      const seed = ephKeyFromPrivHex(seedHex);
      void seed;
      joinProofSig = await signDigest(seedHex, joinProofDigest(chainId, wallet));
    } catch {
      joinProofSig = "0x" as Hex;
    }
  }

  const regMsg = buildRegisterMessage({
    chainId,
    wallet,
    ephAddr: eph.address,
    ephPubHex: eph.pubHex,
  });
  const registerSig = (await walletClient.signTypedData({
    account: wallet,
    domain: EIP712_DOMAIN,
    types: REGISTER_TYPES,
    primaryType: "Register",
    message: regMsg,
  })) as Hex;

  const env = envelopeRegister({
    chainId: chainId.toString(),
    wallet,
    ephAddr: eph.address,
    ephPubHex: eph.pubHex,
    joinProofSig,
    registerSig,
    ...(walletInvite
      ? {
          inviterAddr: walletInvite.inviter,
          inviteExpiresAt: walletInvite.expiresAt.toString(),
          inviteNonce: walletInvite.nonce.toString(),
          inviteSig: walletInvite.sig,
        }
      : {}),
  });

  // Optimistic local insert — flips the UI to "member" immediately so chats
  // start being attributed to the wallet, even if Waku has 0 peers right now.
  addLocalEnvelope?.(env);

  // Cache the signed envelope so we (and other members) can re-broadcast it
  // later without prompting the wallet again. Crucial because Waku store-based
  // history is unreliable on the public fleet — new joiners need someone to
  // republish existing Registers via live filter to learn about prior members.
  cacheRegisterEnvelope(chainId.toString(), wallet, env);

  try {
    await waku.publish(env);
  } catch (e) {
    console.warn("ensureRegistered: Waku publish failed", e);
    throw e;
  }

  return { published: true, eph, envelope: env };
}
