"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import type { DiscoveredChain } from "@/lib/discovery";
import { getLocalChain } from "@/lib/chainsLocal";

interface DiscoverResponse {
  chains?: {
    id: string;
    creator: Address;
    blockNumber: string;
    seedCommit: `0x${string}`;
    expiresAt: string;
  }[];
  error?: unknown;
}

async function fetchDiscoveredChains(): Promise<DiscoveredChain[]> {
  const response = await fetch("/api/chains/discover");
  const body = (await response.json().catch(() => null)) as DiscoverResponse | null;

  if (!response.ok) {
    const msg = typeof body?.error === "string" ? body.error : "Chain discovery failed.";
    throw new Error(msg);
  }
  if (!Array.isArray(body?.chains)) {
    throw new Error("Chain discovery returned an invalid response.");
  }

  return body.chains.map((chain) => ({
    id: BigInt(chain.id),
    creator: chain.creator,
    blockNumber: BigInt(chain.blockNumber),
    seedCommit: chain.seedCommit,
    expiresAt: BigInt(chain.expiresAt),
  }));
}

export function DiscoverPanel() {
  const [items, setItems] = useState<DiscoveredChain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const all = await fetchDiscoveredChains();
        if (!cancelled) setItems(all);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { visible, hiddenCount } = useMemo(() => {
    if (!items) return { visible: items, hiddenCount: 0 };
    let hidden = 0;
    const v = items.filter((c) => {
      const local = getLocalChain(c.id.toString());
      if (local?.discoverable === false) {
        hidden++;
        return showHidden;
      }
      return true;
    });
    return { visible: v, hiddenCount: hidden };
  }, [items, showHidden]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-zinc-900">Discover all chains</h2>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          on-chain events
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-1">
        Every sub-chain ever created on the contract. Joining still requires the
        invite link from a member; visibility ≠ access.
      </p>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="mt-2 text-[11px] text-amber-700 hover:text-amber-800"
        >
          {showHidden
            ? `← hide ${hiddenCount} private chain${hiddenCount === 1 ? "" : "s"}`
            : `+ show ${hiddenCount} private chain${hiddenCount === 1 ? "" : "s"} you've cached`}
        </button>
      ) : null}
      {error ? (
        <p className="text-xs text-red-600 mt-3">{error}</p>
      ) : null}
      {!items ? (
        <p className="text-sm text-zinc-500 mt-3">Scanning…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-3">No chains exist yet.</p>
      ) : visible && visible.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-3">All chains hidden.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {(visible ?? []).map((c) => {
            const local = getLocalChain(c.id.toString());
            const isPrivate = local?.discoverable === false;
            return (
              <li key={c.id.toString()}>
                <Link
                  href={`/chain/${c.id.toString()}`}
                  className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-sky-50 border border-transparent hover:border-sky-200 transition"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium font-mono text-sm text-zinc-900">
                        chain #{c.id.toString()}
                      </span>
                      {local?.name ? (
                        <span className="text-xs text-zinc-700">{local.name}</span>
                      ) : null}
                      {isPrivate ? (
                        <span
                          title="Creator marked this chain as not discoverable"
                          className="text-[9px] uppercase tracking-wide text-amber-700 border border-amber-300 rounded px-1.5 py-0.5"
                        >
                          🔒 private
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      by {c.creator.slice(0, 6)}…{c.creator.slice(-4)} · block{" "}
                      {c.blockNumber.toString()}
                    </div>
                  </div>
                  {local ? (
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${
                        local.role === "creator"
                          ? "text-amber-700 border-amber-300 bg-amber-50"
                          : "text-emerald-700 border-emerald-300 bg-emerald-50"
                      }`}
                    >
                      {local.role === "creator" ? "yours" : "joined"}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-200 px-2 py-0.5 rounded-full shrink-0">
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
