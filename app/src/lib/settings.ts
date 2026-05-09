"use client";

import type { Address, Hex, WalletClient } from "viem";
import {
  cacheSettingsEnvelope,
  upsertLocalChain,
} from "./chainsLocal";
import {
  EIP712_DOMAIN,
  SETTINGS_TYPES,
  type InviteMode,
  type SettingsMessage,
} from "./eip712";
import { envelopeSettings, type ChainEnvelope, type WakuClient } from "./waku";

/** Convenience helper used by both the Create flow and the in-chain Settings
 *  edit page. Asks the wallet to sign a Settings EIP-712 typed-data, publishes
 *  to Waku, optimistically inserts into local replay, and caches the signed
 *  envelope so it can be re-broadcast on future page mounts. */
export async function publishSettings(args: {
  chainId: bigint;
  creator: Address;
  walletClient: WalletClient;
  description: string;
  discoverable: boolean;
  inviteMode: InviteMode;
  waku: WakuClient | null;
  addLocalEnvelope?: (env: ChainEnvelope) => void;
}): Promise<{ envelope: ChainEnvelope; nonce: bigint }> {
  const {
    chainId,
    creator,
    walletClient,
    description,
    discoverable,
    inviteMode,
    waku,
    addLocalEnvelope,
  } = args;
  const nonce = BigInt(Date.now());
  const msg: SettingsMessage = {
    chainId,
    creator,
    nonce,
    description,
    discoverable,
    inviteMode,
  };
  const sig = (await walletClient.signTypedData({
    account: creator,
    domain: EIP712_DOMAIN,
    types: SETTINGS_TYPES,
    primaryType: "Settings",
    message: msg,
  })) as Hex;

  const env = envelopeSettings({
    chainId: chainId.toString(),
    creator,
    nonce: nonce.toString(),
    description,
    discoverable,
    inviteMode,
    sig,
  });

  // Optimistic: render & dedupe locally before Waku echo.
  addLocalEnvelope?.(env);

  // Cache so we (and other members) can re-broadcast without prompting again.
  cacheSettingsEnvelope(chainId.toString(), env);

  // Mirror into the local chain entry for instant render in lists.
  upsertLocalChain({ id: chainId.toString(), description, discoverable, inviteMode });

  if (waku) {
    try {
      await waku.publish(env);
    } catch (e) {
      console.warn("publishSettings: Waku publish failed", e);
    }
  }

  return { envelope: env, nonce };
}
