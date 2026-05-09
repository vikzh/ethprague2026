"use client";

import { useEffect, useState } from "react";

function fmtRemaining(secs: number): string {
  if (secs <= 0) return "expired";
  const d = Math.floor(secs / 86400);
  if (d > 1) return `${d} days left`;
  const h = Math.floor(secs / 3600);
  if (h > 1) return `${h} hours left`;
  const m = Math.floor(secs / 60);
  if (m > 1) return `${m} min left`;
  return `${secs}s left`;
}

export function ExpiryBadge({ expiresAt }: { expiresAt: bigint }) {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (expiresAt === 0n) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-200 rounded-full px-2 py-0.5 bg-zinc-50">
        forever
      </span>
    );
  }
  const exp = Number(expiresAt);
  const remaining = exp - now;
  const expired = remaining <= 0;
  return (
    <span
      title={`Expires at ${new Date(exp * 1000).toLocaleString()}`}
      className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
        expired
          ? "text-red-700 border-red-300 bg-red-50"
          : remaining < 3600
            ? "text-amber-700 border-amber-300 bg-amber-50"
            : "text-emerald-700 border-emerald-300 bg-emerald-50"
      }`}
    >
      {fmtRemaining(remaining)}
    </span>
  );
}
