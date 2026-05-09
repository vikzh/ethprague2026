"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/contract";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    const injected = connectors[0];
    if (!injected) {
      setError("No browser wallet found.");
      return;
    }

    setError(null);
    try {
      await connectAsync({ connector: injected });
    } catch (e) {
      setError((e as Error).message || "Wallet connection failed.");
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void handleConnect()}
          className="rounded-full bg-slate-600 text-white text-sm font-medium px-4 py-2 hover:bg-slate-700 transition disabled:opacity-50 shadow-sm"
          disabled={isPending}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {error ? (
          <span className="max-w-64 text-right text-[11px] text-red-600">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  const wrongChain = chainId !== TARGET_CHAIN_ID;

  return (
    <div className="flex items-center gap-2">
      {wrongChain ? (
        <button
          type="button"
          onClick={() => switchChain({ chainId: TARGET_CHAIN_ID as 11155111 })}
          className="rounded-full bg-amber-500 text-white text-sm font-medium px-3 py-2 hover:bg-amber-600 transition"
        >
          Switch to Sepolia
        </button>
      ) : null}
      <span className="rounded-full bg-zinc-100 text-zinc-800 text-xs font-mono px-3 py-2 border border-zinc-200">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </span>
      <button
        type="button"
        onClick={() => disconnect()}
        className="text-xs text-zinc-500 hover:text-zinc-700"
      >
        disconnect
      </button>
    </div>
  );
}
