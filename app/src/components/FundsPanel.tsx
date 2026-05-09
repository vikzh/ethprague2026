"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { type Address, type Hex, formatEther, parseEther } from "viem";
import { CHAINPOOL_ABI, CHAINPOOL_ADDRESS } from "@/lib/contract";
import { EIP712_DOMAIN, TRANSFER_TYPES, type SignedTransfer } from "@/lib/eip712";
import type { ReplayResult } from "@/lib/state";
import { envelopeTransfer, type WakuClient } from "@/lib/waku";

type Status = { kind: "idle" } | { kind: "pending"; step: string } | { kind: "error"; msg: string };

function fmt(n: bigint | undefined): string {
  return n ? formatEther(n) : "0";
}

export function FundsPanel({
  chainId,
  state,
  waku,
  onAfterTx,
}: {
  chainId: bigint;
  state: ReplayResult | null;
  waku: WakuClient | null;
  onAfterTx?: () => void;
}) {
  const { address } = useAccount();
  const wallet = useWalletClient();
  const publicClient = usePublicClient();
  const [depositInput, setDepositInput] = useState("0.001");
  const [transferAmount, setTransferAmount] = useState("0.0005");
  const [transferTo, setTransferTo] = useState<Address | "">("");
  const [withdrawAmount, setWithdrawAmount] = useState("0");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const myOnchain = useMemo(
    () => (address ? state?.onchainBalance.get(address) ?? 0n : 0n),
    [state, address],
  );
  const myEffective = useMemo(
    () => (address ? state?.effectiveBalance.get(address) ?? 0n : 0n),
    [state, address],
  );
  const totalPool = useMemo(() => {
    if (!state) return 0n;
    let s = 0n;
    for (const v of state.onchainBalance.values()) s += v;
    return s;
  }, [state]);

  const otherMembers = useMemo(() => {
    if (!state || !address) return [] as Address[];
    return [...state.members.keys()].filter(
      (a) => a.toLowerCase() !== address.toLowerCase(),
    );
  }, [state, address]);

  const myPendingTransfers: SignedTransfer[] = useMemo(() => {
    if (!state || !address) return [];
    return state.pendingTransfers.filter((t) => t.from.toLowerCase() === address.toLowerCase());
  }, [state, address]);

  const myNextNonce = useMemo(() => {
    if (!state || !address) return 1n;
    const onchain = state.lastNonceOnchain.get(address) ?? 0n;
    let pendingMax = onchain;
    for (const t of state.pendingTransfers) {
      if (t.from.toLowerCase() === address.toLowerCase() && t.nonce > pendingMax) {
        pendingMax = t.nonce;
      }
    }
    return pendingMax + 1n;
  }, [state, address]);

  async function handleDeposit() {
    if (!wallet.data || !publicClient || !address) return;
    try {
      setStatus({ kind: "pending", step: "Sending deposit tx…" });
      const value = parseEther(depositInput || "0");
      const hash = await wallet.data.writeContract({
        address: CHAINPOOL_ADDRESS,
        abi: CHAINPOOL_ABI,
        functionName: "deposit",
        args: [chainId],
        value,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "idle" });
      onAfterTx?.();
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  async function handleTransfer() {
    if (!wallet.data || !waku || !address) return;
    if (!transferTo) {
      setStatus({ kind: "error", msg: "Pick a recipient" });
      return;
    }
    try {
      setStatus({ kind: "pending", step: "Asking wallet to sign Transfer…" });
      const amount = parseEther(transferAmount || "0");
      const nonce = myNextNonce;
      const sig = (await wallet.data.signTypedData({
        account: address,
        domain: EIP712_DOMAIN,
        types: TRANSFER_TYPES,
        primaryType: "Transfer",
        message: {
          chainId,
          from: address,
          to: transferTo as Address,
          amount,
          nonce,
        },
      })) as Hex;
      setStatus({ kind: "pending", step: "Publishing Transfer to Waku…" });
      await waku.publish(
        envelopeTransfer({
          chainId: chainId.toString(),
          from: address,
          to: transferTo as Address,
          amount: amount.toString(),
          nonce: nonce.toString(),
          sig,
        }),
      );
      setStatus({ kind: "idle" });
      onAfterTx?.();
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  async function handleSync() {
    if (!wallet.data || !publicClient || !state) return;
    if (state.pendingTransfers.length === 0) {
      setStatus({ kind: "error", msg: "Nothing to sync" });
      return;
    }
    try {
      setStatus({
        kind: "pending",
        step: `Submitting ${state.pendingTransfers.length} transfer(s) on-chain…`,
      });
      const txs = state.pendingTransfers.map((t) => ({
        chainId: t.chainId,
        from: t.from,
        to: t.to,
        amount: t.amount,
        nonce: t.nonce,
      }));
      const sigs = state.pendingTransfers.map((t) => t.sig);
      const hash = await wallet.data.writeContract({
        address: CHAINPOOL_ADDRESS,
        abi: CHAINPOOL_ABI,
        functionName: "applyTransfers",
        args: [txs, sigs],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "idle" });
      onAfterTx?.();
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  async function handleWithdraw() {
    if (!wallet.data || !publicClient) return;
    try {
      setStatus({ kind: "pending", step: "Sending withdraw tx…" });
      const amount = parseEther(withdrawAmount || "0");
      const hash = await wallet.data.writeContract({
        address: CHAINPOOL_ADDRESS,
        abi: CHAINPOOL_ABI,
        functionName: "withdraw",
        args: [chainId, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "idle" });
      onAfterTx?.();
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 border-l border-zinc-800 bg-zinc-950 w-full lg:w-80">
      <div>
        <h3 className="text-sm font-medium text-zinc-300">Privacy pool</h3>
        <p className="text-xs text-zinc-500 mt-1">
          On-chain ledger of who owns what inside this chain.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 p-3 space-y-1">
        <Row label="Pool total" value={`${fmt(totalPool)} ETH`} />
        <Row label="Your on-chain" value={`${fmt(myOnchain)} ETH`} />
        <Row
          label="Your effective"
          value={`${fmt(myEffective)} ETH`}
          hint="after pending signed transfers"
        />
      </div>

      <Section title="Deposit">
        <div className="flex gap-2">
          <input
            value={depositInput}
            onChange={(e) => setDepositInput(e.target.value)}
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void handleDeposit()}
            className="rounded bg-white text-black text-xs font-medium px-3"
          >
            Deposit
          </button>
        </div>
      </Section>

      <Section title="Send to member (off-chain)">
        <select
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value as Address)}
          className="w-full rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
        >
          <option value="">— select —</option>
          {otherMembers.map((m) => (
            <option key={m} value={m}>
              {m.slice(0, 6)}…{m.slice(-4)}
            </option>
          ))}
        </select>
        <div className="flex gap-2 mt-2">
          <input
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void handleTransfer()}
            disabled={!waku}
            className="rounded bg-white text-black text-xs font-medium px-3 disabled:opacity-50"
          >
            Sign &amp; send
          </button>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">next nonce: {myNextNonce.toString()}</p>
      </Section>

      <Section title="Pending sync">
        {state ? (
          state.pendingTransfers.length === 0 ? (
            <p className="text-xs text-zinc-500">No pending transfers.</p>
          ) : (
            <>
              <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                {state.pendingTransfers.map((t) => (
                  <li
                    key={`${t.from}:${t.nonce.toString()}`}
                    className="flex justify-between font-mono text-zinc-300"
                  >
                    <span>
                      {t.from.slice(0, 6)} → {t.to.slice(0, 6)}
                    </span>
                    <span>{fmt(t.amount)} ETH</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void handleSync()}
                className="mt-2 w-full rounded bg-emerald-500 text-black text-xs font-medium px-3 py-1.5"
              >
                Sync {state.pendingTransfers.length} to chain
              </button>
            </>
          )
        ) : (
          <p className="text-xs text-zinc-500">Loading…</p>
        )}
        {myPendingTransfers.length > 0 ? (
          <p className="text-[10px] text-zinc-500 mt-1">
            ({myPendingTransfers.length} of those are yours)
          </p>
        ) : null}
      </Section>

      <Section title="Withdraw">
        <div className="flex gap-2">
          <input
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder={fmt(myOnchain)}
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void handleWithdraw()}
            className="rounded bg-white text-black text-xs font-medium px-3"
          >
            Withdraw
          </button>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">
          Withdraws straight from your on-chain pool balance.
        </p>
      </Section>

      {status.kind === "pending" ? (
        <p className="text-xs text-zinc-400">{status.step}</p>
      ) : null}
      {status.kind === "error" ? (
        <p className="text-xs text-red-400 break-words">{status.msg}</p>
      ) : null}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-zinc-400">
        {label}
        {hint ? <span className="block text-[10px] text-zinc-600">{hint}</span> : null}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">{title}</div>
      {children}
    </div>
  );
}
