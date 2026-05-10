"use client";

import type { Address, Hex } from "viem";

// Dynamic import keeps the heavy bundle out of SSR.

export type ChainEnvelope = {
  type: "register" | "chat" | "transfer" | "poll" | "vote" | "settings";
  body: unknown;
  ts: number;
};

export interface WakuClient {
  topic: string;
  publish: (env: ChainEnvelope) => Promise<void>;
  subscribe: (cb: (env: ChainEnvelope) => void) => Promise<() => void>;
  history: (cb: (env: ChainEnvelope) => void) => Promise<void>;
  peerCount: () => Promise<number>;
  destroy: () => Promise<void>;
}

let nodePromise: Promise<unknown> | null = null;

async function getNode(): Promise<unknown> {
  if (!nodePromise) {
    nodePromise = (async () => {
      const sdk = await import("@waku/sdk");
      const node = await sdk.createLightNode({
        defaultBootstrap: true,
      });
      await node.start();
      return node;
    })();
  }
  return nodePromise;
}

/** Per-chain Waku content topic.
 *
 *  Format: /{app}/{version}/{name}/{encoding} — exactly 4 path segments,
 *  which the SDK validates as: no generation prefix, parts.length == 5.
 *
 *  The contract address and chain id are joined with "-" (not "/") so the
 *  topic stays at 4 segments. A "/" separator would produce 5 segments,
 *  causing the SDK to misread the app name as a numeric "generation" field
 *  and throw "Invalid generation field in content topic". */
function topicFor(chainId: bigint, contractAddress: Address): string {
  const addr = contractAddress.toLowerCase();
  return `/pocketchains/1/${addr}-${chainId.toString()}/json`;
}

function encodePayload(env: ChainEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(env));
}

function decodePayload(payload: Uint8Array): ChainEnvelope | null {
  try {
    const obj = JSON.parse(new TextDecoder().decode(payload)) as ChainEnvelope;
    if (
      obj &&
      typeof obj === "object" &&
      typeof obj.type === "string" &&
      typeof obj.ts === "number"
    ) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

interface NodeShape {
  createEncoder: (params: { contentTopic: string; shardId?: number }) => unknown;
  createDecoder: (params: { contentTopic: string; shardId?: number }) => unknown;
  lightPush?: {
    send: (encoder: unknown, message: { payload: Uint8Array }) => Promise<unknown>;
  };
  filter?: {
    subscribe: (
      decoders: unknown | unknown[],
      callback: (msg: { payload?: Uint8Array }) => void,
    ) => Promise<unknown>;
    unsubscribe: (decoders: unknown | unknown[]) => Promise<unknown>;
  };
  store?: {
    queryWithOrderedCallback: (
      decoders: unknown[],
      callback: (msg: { payload?: Uint8Array }) => void | boolean | Promise<void | boolean>,
    ) => Promise<void>;
  };
  getConnectedPeers?: () => Promise<unknown[]>;
}

export async function createWakuClient(
  chainId: bigint,
  contractAddress: Address,
): Promise<WakuClient> {
  const node = (await getNode()) as NodeShape;
  const topic = topicFor(chainId, contractAddress);
  const encoder = node.createEncoder({ contentTopic: topic });
  const decoder = node.createDecoder({ contentTopic: topic });

  return {
    topic,
    publish: async (env) => {
      if (!node.lightPush) throw new Error("Waku lightPush unavailable");
      const result = (await node.lightPush.send(encoder, {
        payload: encodePayload(env),
      })) as { successes?: unknown[]; failures?: unknown[] } | undefined;
      if (
        result &&
        Array.isArray(result.successes) &&
        result.successes.length === 0 &&
        Array.isArray(result.failures) &&
        result.failures.length > 0
      ) {
        throw new Error(
          `Waku lightPush: 0 successes, ${result.failures.length} failures (no peers?)`,
        );
      }
    },
    peerCount: async () => {
      if (!node.getConnectedPeers) return 0;
      try {
        const peers = await node.getConnectedPeers();
        return Array.isArray(peers) ? peers.length : 0;
      } catch {
        return 0;
      }
    },
    subscribe: async (cb) => {
      if (!node.filter) {
        return () => {};
      }
      await node.filter.subscribe(decoder, (msg: { payload?: Uint8Array }) => {
        if (!msg?.payload) return;
        const env = decodePayload(msg.payload);
        if (env) cb(env);
      });
      return () => {
        try {
          if (node.filter) void node.filter.unsubscribe(decoder);
        } catch {
          // noop
        }
      };
    },
    history: async (cb) => {
      if (!node.store) return;
      try {
        await node.store.queryWithOrderedCallback([decoder], (msg) => {
          if (!msg?.payload) return;
          const env = decodePayload(msg.payload);
          if (env) cb(env);
        });
      } catch {
        // store may be unavailable; live subscribe still works
      }
    },
    destroy: async () => {},
  };
}

// Outbound message factories.
export function envelopeRegister(payload: {
  chainId: string;
  wallet: string;
  ephAddr: string;
  ephPubHex: Hex;
  joinProofSig: Hex;
  registerSig: Hex;
  // Optional wallet-signed invite — present when chain policy isn't "open".
  inviterAddr?: string;
  inviteExpiresAt?: string;
  inviteNonce?: string;
  inviteSig?: Hex;
}): ChainEnvelope {
  return { type: "register", body: payload, ts: Date.now() };
}

export function envelopeChat(payload: {
  chainId: string;
  channelId: string;
  ephAddr: string;
  nonce: string;
  contentType: number;
  content: Hex;
  sig: Hex;
  /** Present iff this chat is an end-to-end-encrypted DM. Recipient wallet. */
  dmTo?: string;
}): ChainEnvelope {
  return { type: "chat", body: payload, ts: Date.now() };
}

export function envelopeTransfer(payload: {
  chainId: string;
  from: string;
  to: string;
  amount: string;
  nonce: string;
  sig: Hex;
}): ChainEnvelope {
  return { type: "transfer", body: payload, ts: Date.now() };
}

export function envelopePoll(payload: {
  chainId: string;
  pollId: string;
  ephAddr: string;
  question: string;
  options: string[];
  deadline: string; // unix seconds as decimal string
  nonce: string;
  sig: Hex;
}): ChainEnvelope {
  return { type: "poll", body: payload, ts: Date.now() };
}

export function envelopeVote(payload: {
  chainId: string;
  pollId: string;
  ephAddr: string;
  optionIdx: number;
  nonce: string;
  sig: Hex;
}): ChainEnvelope {
  return { type: "vote", body: payload, ts: Date.now() };
}

export function envelopeSettings(payload: {
  chainId: string;
  creator: string;
  nonce: string;
  description: string;
  discoverable: boolean;
  inviteMode: string;
  channelsJson: string;
  pollMode: string;
  sig: Hex;
}): ChainEnvelope {
  return { type: "settings", body: payload, ts: Date.now() };
}
