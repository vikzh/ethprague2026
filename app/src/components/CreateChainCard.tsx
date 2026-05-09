"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { keccak256, encodeAbiParameters, parseEventLogs, type Hex } from "viem";
import { saveChainSeed } from "@/lib/chainKey";
import { getLocalChain, upsertLocalChain } from "@/lib/chainsLocal";
import { CHAINPOOL_ABI, CHAINPOOL_ADDRESS } from "@/lib/contract";
import { generateEphKey, saveEphKey } from "@/lib/ephemeral";
import { ensureRegistered } from "@/lib/registration";
import { publishSettings } from "@/lib/settings";
import { createWakuClient } from "@/lib/waku";

type Status = { kind: "idle" } | { kind: "pending"; step: string } | { kind: "error"; msg: string };

const TTL_OPTIONS: { label: string; seconds: bigint }[] = [
  { label: "Forever", seconds: 0n },
  { label: "1 hour", seconds: 3_600n },
  { label: "1 day", seconds: 86_400n },
  { label: "1 week", seconds: 604_800n },
  { label: "30 days", seconds: 2_592_000n },
];

export function CreateChainCard({ parentChainId }: { parentChainId?: string } = {}) {
  const isFork = !!parentChainId;
  const parent = isFork ? getLocalChain(parentChainId!) : null;
  const { address } = useAccount();
  const wallet = useWalletClient();
  const publicClient = usePublicClient();
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [name, setName] = useState(
    isFork ? `${parent?.name || `Chain #${parentChainId}`} (fork)` : "",
  );
  const [description, setDescription] = useState("");
  const [discoverable, setDiscoverable] = useState<boolean>(true);
  const [ttlSeconds, setTtlSeconds] = useState<bigint>(0n);

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
        args: [seedCommit, ttlSeconds],
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

      // Persist seed privkey locally so creator can show invite QR later
      // and so we can derive the chain symmetric key for encrypted chats.
      saveChainSeed(chainId, seed.privHex);

      // Pre-create our own ephemeral chat key for this chain.
      const myEph = generateEphKey();
      saveEphKey(chainId, address, myEph);

      // Cache chain metadata locally so it shows up in "My chains" instantly.
      upsertLocalChain({
        id: chainId.toString(),
        name: name.trim(),
        role: "creator",
        forkedFrom: parentChainId,
      });

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
        // Only ask for the Settings signature if the user actually changed
        // something off-default (description set, or Discoverable toggled off).
        const wantsSettings = description.trim().length > 0 || discoverable === false;
        if (wantsSettings) {
          setStatus({
            kind: "pending",
            step: "Sign Settings (description / discoverable) in your wallet…",
          });
          try {
            await publishSettings({
              chainId,
              creator: address,
              walletClient: wallet.data,
              description: description.trim(),
              discoverable,
              waku,
            });
          } catch (e) {
            console.warn("CreateChainCard: publishSettings failed", e);
          }
        }
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
      <h2 className="text-lg font-medium">
        {isFork ? "Fork chain" : "Create a sub-chain"}
      </h2>
      <p className="text-sm text-zinc-400 mt-1">
        {isFork ? (
          <>
            One on-chain tx spawns a sibling chain marked as forked from{" "}
            <span className="font-mono text-zinc-300">#{parentChainId}</span>. The new
            chain has its own seed and members must opt in via your new invite — the
            parent stays untouched.
          </>
        ) : (
          <>One on-chain tx spawns a new pocket chain. You become member #1 and get an invite QR to share.</>
        )}
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional, only stored locally)"
          maxLength={64}
          className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isFork
              ? 'About the fork (optional, published — visible to all members)'
              : "About this chain (optional, published — visible to all members)"
          }
          maxLength={280}
          rows={2}
          className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
        />
        <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={discoverable}
            onChange={(e) => setDiscoverable(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <span className="flex flex-col">
            <span>Discoverable in the global Discover list</span>
            <span className="text-[10px] text-zinc-500">
              When off, members who have visited the chain will hide it from their
              Discover list. Note: the on-chain creation event is permanent and
              still visible to anyone who hasn&apos;t cached your settings.
            </span>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Lifetime
          </span>
          <select
            value={ttlSeconds.toString()}
            onChange={(e) => setTtlSeconds(BigInt(e.target.value))}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600"
          >
            {TTL_OPTIONS.map((o) => (
              <option key={o.label} value={o.seconds.toString()}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-500">
            After this, deposits & transfers are blocked. Withdrawals stay open
            so members can drain the pool.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={status.kind === "pending"}
            className="rounded-lg bg-white text-black text-sm font-medium px-4 py-2 hover:bg-zinc-200 disabled:opacity-50"
          >
            {status.kind === "pending"
              ? "Working…"
              : isFork
                ? "Create fork"
                : "Create chain"}
          </button>
          {status.kind === "pending" ? (
            <span className="text-xs text-zinc-500">{status.step}</span>
          ) : null}
          {status.kind === "error" ? (
            <span className="text-xs text-red-400 truncate">{status.msg}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
