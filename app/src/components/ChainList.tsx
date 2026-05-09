"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { type Address, getAbiItem } from "viem";
import { CHAINPOOL_ABI, IS_CONTRACT_CONFIGURED } from "@/lib/contract";
import { getChunkedLogs } from "@/lib/logs";

interface ChainSummary {
  id: bigint;
  isCreator: boolean;
}

const chainCreatedEvent = getAbiItem({ abi: CHAINPOOL_ABI, name: "ChainCreated" });
const depositedEvent = getAbiItem({ abi: CHAINPOOL_ABI, name: "Deposited" });

export function ChainList() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [items, setItems] = useState<ChainSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !address) return;
    if (!IS_CONTRACT_CONFIGURED) {
      setError("ChainPool address is unset. Add NEXT_PUBLIC_CHAINPOOL_ADDRESS to app/.env.local and restart.");
      setItems([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        if (!publicClient || !address) return;
        const [created, deposited] = await Promise.all([
          getChunkedLogs(publicClient, chainCreatedEvent, { creator: address as Address }),
          getChunkedLogs(publicClient, depositedEvent, { from: address as Address }),
        ]);
        const ids = new Map<string, ChainSummary>();
        for (const log of created) {
          const id = (log as unknown as { args: { id: bigint } }).args.id;
          ids.set(id.toString(), { id, isCreator: true });
        }
        for (const log of deposited) {
          const id = (log as unknown as { args: { id: bigint } }).args.id;
          if (!ids.has(id.toString())) {
            ids.set(id.toString(), { id, isCreator: false });
          }
        }
        // also include local invites the user has stored from /join
        if (typeof window !== "undefined") {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k) continue;
            const m = k.match(/^pc_eph:(\d+):(0x[0-9a-fA-F]{40})$/);
            if (!m) continue;
            if (m[2].toLowerCase() !== address.toLowerCase()) continue;
            const id = BigInt(m[1]);
            if (!ids.has(id.toString())) {
              ids.set(id.toString(), { id, isCreator: false });
            }
          }
        }
        const list = [...ids.values()].sort((a, b) =>
          a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
        );
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-lg font-medium">Your chains</h2>
      {error ? (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      ) : null}
      {!items ? (
        <p className="text-sm text-zinc-500 mt-2">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-2">
          No chains yet. Create one above, or open an invite link.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {items.map((c) => (
            <li key={c.id.toString()}>
              <Link
                href={`/chain/${c.id.toString()}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-zinc-900 transition"
              >
                <span className="font-mono text-sm">chain #{c.id.toString()}</span>
                {c.isCreator ? (
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    creator
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
