"use client";

import type { Address, Hex } from "viem";
import type { WalletClient } from "viem";
import { cacheRegisterEnvelope } from "./chainsLocal";
import {
  EIP712_DOMAIN,
  REGISTER_TYPES,
  buildRegisterMessage,
  joinProofDigest,
} from "./eip712";
import {
  ephKeyFromPrivHex,
  loadOrCreateEphKey,
  signDigest,
  type EphKey,
} from "./ephemeral";
import { envelopeRegister, type ChainEnvelope, type WakuClient } from "./waku";

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
  addLocalEnvelope?: (env: ChainEnvelope) => void;
}): Promise<{ published: boolean; eph: EphKey; envelope?: ChainEnvelope } | null> {
  const { chainId, wallet, walletClient, waku, isAlreadyMember, addLocalEnvelope } = args;
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
