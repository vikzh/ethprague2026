"use client";

import { useEffect, useState } from "react";
import { getLocalChain } from "@/lib/chainsLocal";

export function ChainHeaderTitle({ id }: { id: string }) {
  const [name, setName] = useState<string>("");
  const [forkedFrom, setForkedFrom] = useState<string | null>(null);
  useEffect(() => {
    const meta = getLocalChain(id);
    setName(meta?.name ?? "");
    setForkedFrom(meta?.forkedFrom ?? null);
  }, [id]);

  return (
    <span className="text-sm text-zinc-500 font-mono flex items-baseline gap-2 flex-wrap">
      <span>/ chain #{id}</span>
      {name ? (
        <span className="font-sans text-zinc-900 font-medium">{name}</span>
      ) : null}
      {forkedFrom ? (
        <a
          href={`/chain/${forkedFrom}`}
          title="View the parent chain this was forked from"
          className="font-sans text-[10px] uppercase tracking-wide text-amber-700 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-50"
        >
          ↳ forked from #{forkedFrom}
        </a>
      ) : null}
    </span>
  );
}
