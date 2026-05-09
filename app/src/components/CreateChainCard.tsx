"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { keccak256, encodeAbiParameters, parseEventLogs, type Hex } from "viem";
import { CHAINPOOL_ABI, CHAINPOOL_ADDRESS } from "@/lib/contract";
import { generateEphKey, saveEphKey } from "@/lib/ephemeral";
import { ensureRegistered } from "@/lib/registration";
import { createWakuClient } from "@/lib/waku";

type Status = { kind: "idle" } | { kind: "pending"; step: string } | { kind: "error"; msg: string };

export function CreateChainCard() {
  const { address } = useAccount();
  const wallet = useWalletClient();
  const publicClient = usePublicClient();
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleCreate() {
    if (!wallet.data || !publicClient || !address) return;
    try {
      setStatus({ kind: "pending", step: "Generating chain seed…" });
      const seed = generateEphKey();
      const seedCommit = keccak256(
        encodeAbiParameters([{ type: "address" }], [seed.address]),
      ) as Hex;

      setStatus({ kind: "pending", step: "Sending createChain tx…" });
      const txHash = await wallet.data.writeContract({
        address: CHAINPOOL_ADDRESS,
        abi: CHAINPOOL_ABI,
        functionName: "createChain",
        args: [seedCommit],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      const events = parseEventLogs({
        abi: CHAINPOOL_ABI,
        eventName: "ChainCreated",
        logs: receipt.logs,
      });
      let chainId: bigint | null = null;
      if (events[0]) {
        chainId = events[0].args.id as bigint;
      } else {
        const next = await publicClient.readContract({
          address: CHAINPOOL_ADDRESS,
          abi: CHAINPOOL_ABI,
          functionName: "nextChainId",
        });
        chainId = (next as bigint) - 1n;
      }
      if (chainId === null) throw new Error("Could not determine new chain id");

      // Persist seed privkey locally so creator can show invite QR later.
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `pc_seed:${chainId.toString()}`,
          seed.privHex,
        );
      }

      // Pre-create our own ephemeral chat key for this chain.
      const myEph = generateEphKey();
      saveEphKey(chainId, address, myEph);

      // Publish Register on Waku now so the creator's chats aren't dropped by
      // replay's membership check. Soft-fail: if Waku isn't reachable we still
      // route to the chain; ChainView will retry on mount.
      setStatus({ kind: "pending", step: "Connecting to Waku…" });
      try {
        const waku = await createWakuClient(chainId);
        setStatus({ kind: "pending", step: "Sign Register message in your wallet…" });
        await ensureRegistered({
          chainId,
          wallet: address,
          walletClient: wallet.data,
          waku,
          isAlreadyMember: false,
          seedPrivHex: seed.privHex,
        });
      } catch (e) {
        console.warn("CreateChainCard: ensureRegistered failed", e);
      }

      router.push(`/chain/${chainId.toString()}?firstJoin=1`);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-lg font-medium">Create a chain</h2>
      <p className="text-sm text-zinc-400 mt-1">
        Spawns a new sub-chain on-chain (1 tx). You become the first member and get an
        invite QR to share.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={status.kind === "pending"}
          className="rounded-lg bg-white text-black text-sm font-medium px-4 py-2 hover:bg-zinc-200 disabled:opacity-50"
        >
          {status.kind === "pending" ? "Working…" : "Create chain"}
        </button>
        {status.kind === "pending" ? (
          <span className="text-xs text-zinc-500">{status.step}</span>
        ) : null}
        {status.kind === "error" ? (
          <span className="text-xs text-red-400 truncate">{status.msg}</span>
        ) : null}
      </div>
    </div>
  );
}
