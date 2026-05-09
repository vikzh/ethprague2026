"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { discoverAllChains, type DiscoveredChain } from "@/lib/discovery";
import { getLocalChain } from "@/lib/chainsLocal";

export function DiscoverPanel() {
  const publicClient = usePublicClient();
  const [items, setItems] = useState<DiscoveredChain[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await discoverAllChains(publicClient);
        if (!cancelled) setItems(all);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">Discover all chains</h2>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          on-chain events
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-1">
        Every sub-chain ever created on the contract. Joining still requires the
        invite link from a member; visibility ≠ access.
      </p>
      {error ? (
        <p className="text-xs text-red-400 mt-3">{error}</p>
      ) : null}
      {!items ? (
        <p className="text-sm text-zinc-500 mt-3">Scanning…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-3">No chains exist yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {items.map((c) => {
            const local = getLocalChain(c.id.toString());
            return (
              <li key={c.id.toString()}>
                <Link
                  href={`/chain/${c.id.toString()}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium font-mono text-sm">
                        chain #{c.id.toString()}
                      </span>
                      {local?.name ? (
                        <span className="text-xs text-zinc-300">{local.name}</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      by {c.creator.slice(0, 6)}…{c.creator.slice(-4)} · block{" "}
                      {c.blockNumber.toString()}
                    </div>
                  </div>
                  {local ? (
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border shrink-0 ${
                        local.role === "creator"
                          ? "text-amber-300 border-amber-500/40"
                          : "text-emerald-300 border-emerald-500/40"
                      }`}
                    >
                      {local.role === "creator" ? "yours" : "joined"}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600 border border-zinc-800 px-2 py-0.5 rounded shrink-0">
                      open
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
