"use client";

import { useAccount } from "wagmi";
import { ChainList } from "./ChainList";
import { CreateChainCard } from "./CreateChainCard";

export function HomeBody() {
  const { isConnected } = useAccount();

  return (
    <div className="flex-1 flex flex-col items-center w-full px-6 py-10">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Sub-chains for small groups</h1>
          <p className="mt-2 text-zinc-400 max-w-lg">
            Spin up a chain, share a QR, chat over Waku, send each other ETH with signed
            cheques redeemed on-chain in one batch. No backend.
          </p>
        </section>
        {isConnected ? (
          <>
            <CreateChainCard />
            <ChainList />
          </>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-400">
            Connect a wallet to create or join a chain.
          </div>
        )}
      </div>
    </div>
  );
}
