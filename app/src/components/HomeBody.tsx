"use client";

import { useAccount } from "wagmi";
import { CreateChainCard } from "./CreateChainCard";
import { DiscoverPanel } from "./DiscoverPanel";
import { MyChainsPanel } from "./MyChainsPanel";
import { RestoreChainCard } from "./RestoreChainCard";

export function HomeBody() {
  const { isConnected } = useAccount();

  return (
    <div className="flex-1 flex flex-col items-center w-full px-6 py-10">
      <div className="w-full max-w-5xl flex flex-col gap-8">
        <section>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
            Pocket chains
          </h1>
          <p className="mt-3 text-zinc-600 max-w-2xl text-base leading-relaxed">
            Tiny ad-hoc sub-chains for groups. Spin one up in one tx, share a QR,
            chat over Waku (with end-to-end-encrypted DMs), and send each other
            ETH with off-chain signed cheques redeemed on-chain in one batch. No
            backend, no infra.
          </p>
        </section>

        {isConnected ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-6">
              <CreateChainCard />
              <RestoreChainCard />
              <MyChainsPanel />
            </div>
            <DiscoverPanel />
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-500 shadow-sm">
            Connect a wallet to create or join a chain.
          </div>
        )}
      </div>
    </div>
  );
}
