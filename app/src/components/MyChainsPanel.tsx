"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listLocalChains, type LocalChainEntry } from "@/lib/chainsLocal";

function fmtAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function MyChainsPanel() {
  const [items, setItems] = useState<LocalChainEntry[] | null>(null);

  useEffect(() => {
    setItems(listLocalChains());
    // refresh on storage change so two tabs stay in sync
    const handler = () => setItems(listLocalChains());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-zinc-900">My chains</h2>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          local cache
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-1">
        Chains you&apos;ve created or joined on this device.
      </p>
      {!items ? (
        <p className="text-sm text-zinc-500 mt-3">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 mt-3">
          None yet. Create one or open an invite link.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chain/${c.id}`}
                className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-sky-50 border border-transparent hover:border-sky-200 transition group"
              >
                <div className="flex flex-col min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                    <span className="font-medium truncate text-zinc-900">
                      {c.name || `Chain #${c.id}`}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                      #{c.id}
                    </span>
                    {c.forkedFrom ? (
                      <span
                        title={`Forked from chain #${c.forkedFrom}`}
                        className="text-[9px] uppercase tracking-wide text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 shrink-0"
                      >
                        ↳ #{c.forkedFrom}
                      </span>
                    ) : null}
                    {c.discoverable === false ? (
                      <span
                        title="Creator marked this chain as not discoverable"
                        className="text-[9px] uppercase tracking-wide text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 shrink-0"
                      >
                        🔒 private
                      </span>
                    ) : null}
                  </div>
                  {c.description ? (
                    <div className="text-[11px] text-zinc-600 italic truncate">
                      {c.description}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-zinc-500">
                    last visited {fmtAge(c.lastVisitedAt)}
                  </div>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${
                    c.role === "creator"
                      ? "text-amber-700 border-amber-300 bg-amber-50"
                      : "text-emerald-700 border-emerald-300 bg-emerald-50"
                  }`}
                >
                  {c.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
