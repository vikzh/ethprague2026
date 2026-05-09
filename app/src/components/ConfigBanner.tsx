"use client";

import { CHAINPOOL_ADDRESS, IS_CONTRACT_CONFIGURED, TARGET_CHAIN_ID } from "@/lib/contract";

export function ConfigBanner() {
  if (IS_CONTRACT_CONFIGURED) return null;
  return (
    <div className="bg-amber-950/40 border-b border-amber-800/60 px-6 py-3 text-xs text-amber-200">
      <div className="font-medium mb-1">ChainPool address is not configured.</div>
      <div className="text-amber-200/80">
        Create <code className="font-mono">app/.env.local</code> from{" "}
        <code className="font-mono">app/.env.example</code> and set{" "}
        <code className="font-mono">NEXT_PUBLIC_CHAINPOOL_ADDRESS</code> (and{" "}
        <code className="font-mono">NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK</code>) to the
        deployment from <code className="font-mono">forge script script/Deploy.s.sol</code>.
        Then restart <code className="font-mono">npm run dev</code>. Currently using{" "}
        <code className="font-mono">{CHAINPOOL_ADDRESS}</code> on chain {TARGET_CHAIN_ID}.
      </div>
    </div>
  );
}
