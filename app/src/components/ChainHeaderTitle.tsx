"use client";

import { useEffect, useState } from "react";
import { getLocalChain } from "@/lib/chainsLocal";

export function ChainHeaderTitle({ id }: { id: string }) {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    const meta = getLocalChain(id);
    setName(meta?.name ?? "");
  }, [id]);

  return (
    <span className="text-sm text-zinc-500 font-mono flex items-baseline gap-2">
      <span>/ chain #{id}</span>
      {name ? (
        <span className="font-sans text-zinc-300 font-medium">{name}</span>
      ) : null}
    </span>
  );
}
