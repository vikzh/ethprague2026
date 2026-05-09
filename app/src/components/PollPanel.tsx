"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { type Hex, bytesToHex } from "viem";
import { pollDigest, voteDigest } from "@/lib/eip712";
import { loadOrCreateEphKey, signDigest } from "@/lib/ephemeral";
import type { PollRecord, ReplayResult } from "@/lib/state";
import {
  envelopePoll,
  envelopeVote,
  type ChainEnvelope,
  type WakuClient,
} from "@/lib/waku";

const DEADLINE_OPTIONS: { label: string; seconds: number }[] = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
  { label: "Forever", seconds: 0 },
];

function randomPollId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return "0x" + bytesToHex(buf).replace(/^0x/, "");
}

function fmtRemaining(deadline: bigint): string {
  if (deadline === 0n) return "no deadline";
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(deadline) - now;
  if (diff <= 0) return "closed";
  if (diff < 60) return `${diff}s left`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

export function PollPanel({
  chainId,
  state,
  waku,
  isMember,
  addLocalEnvelope,
  expired,
}: {
  chainId: bigint;
  state: ReplayResult | null;
  waku: WakuClient | null;
  isMember: boolean;
  addLocalEnvelope?: (env: ChainEnvelope) => void;
  expired: boolean;
}) {
  const { address } = useAccount();
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [deadlineSecs, setDeadlineSecs] = useState<number>(86400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const polls = useMemo<PollRecord[]>(() => {
    if (!state) return [];
    return [...state.polls.values()].sort((a, b) => b.ts - a.ts);
  }, [state]);

  function setOptionAt(i: number, val: string) {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  }

  function addOption() {
    if (options.length >= 8) return;
    setOptions([...options, ""]);
  }
  function removeOption(i: number) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  }

  async function handleCreatePoll() {
    if (!address || !waku) return;
    const trimmedQuestion = question.trim();
    const trimmedOpts = options.map((o) => o.trim()).filter(Boolean);
    if (!trimmedQuestion) {
      setError("Question is required.");
      return;
    }
    if (trimmedOpts.length < 2) {
      setError("Need at least 2 options.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const eph = loadOrCreateEphKey(chainId, address);
      const pollId = randomPollId();
      const nonce = BigInt(Date.now());
      const deadline =
        deadlineSecs === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + deadlineSecs);
      const digest = pollDigest({
        chainId,
        pollId,
        question: trimmedQuestion,
        options: trimmedOpts,
        deadline,
        nonce,
      });
      const sig = await signDigest(eph.privHex, digest);
      const env = envelopePoll({
        chainId: chainId.toString(),
        pollId,
        ephAddr: eph.address,
        question: trimmedQuestion,
        options: trimmedOpts,
        deadline: deadline.toString(),
        nonce: nonce.toString(),
        sig,
      });
      addLocalEnvelope?.(env);
      try {
        await waku.publish(env);
      } catch (e) {
        console.warn("PollPanel: publish poll failed", e);
      }
      setQuestion("");
      setOptions(["", ""]);
      setCreating(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(poll: PollRecord, optionIdx: number) {
    if (!address || !waku) return;
    try {
      const eph = loadOrCreateEphKey(chainId, address);
      const nonce = BigInt(Date.now());
      const digest = voteDigest({
        chainId,
        pollId: poll.pollId,
        optionIdx,
        nonce,
      });
      const sig = await signDigest(eph.privHex, digest);
      const env = envelopeVote({
        chainId: chainId.toString(),
        pollId: poll.pollId,
        ephAddr: eph.address,
        optionIdx,
        nonce: nonce.toString(),
        sig,
      });
      addLocalEnvelope?.(env);
      try {
        await waku.publish(env);
      } catch (e) {
        console.warn("PollPanel: publish vote failed", e);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalMembers = state?.members.size ?? 0;
  const canParticipate = isMember && !expired;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200">
        <div className="text-sm text-zinc-700">
          Polls{" "}
          <span className="text-xs text-zinc-500">
            ({polls.length} · {totalMembers} member{totalMembers === 1 ? "" : "s"})
          </span>
        </div>
        {canParticipate ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="rounded-full bg-slate-600 hover:bg-slate-700 text-white text-xs font-medium px-3 py-1.5 transition"
          >
            {creating ? "Cancel" : "+ New poll"}
          </button>
        ) : (
          <span className="text-[11px] text-zinc-500">
            {expired ? "Chain expired" : "Membership required"}
          </span>
        )}
      </div>

      {creating ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 flex flex-col gap-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question"
            className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500"
            maxLength={200}
          />
          <div className="flex flex-col gap-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => setOptionAt(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  maxLength={80}
                  className="flex-1 rounded-lg bg-white border border-zinc-200 px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500"
                />
                {options.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="text-zinc-500 hover:text-zinc-700 text-xs"
                  >
                    remove
                  </button>
                ) : null}
              </div>
            ))}
            {options.length < 8 ? (
              <button
                type="button"
                onClick={addOption}
                className="text-xs text-slate-700 hover:text-slate-900 self-start font-medium"
              >
                + add option
              </button>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Deadline:
            <select
              value={deadlineSecs}
              onChange={(e) => setDeadlineSecs(Number(e.target.value))}
              className="rounded-lg bg-white border border-zinc-200 px-2 py-1.5 text-sm"
            >
              {DEADLINE_OPTIONS.map((o) => (
                <option key={o.label} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCreatePoll()}
              disabled={busy}
              className="rounded-full bg-slate-600 hover:bg-slate-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition"
            >
              {busy ? "Publishing…" : "Publish poll"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {polls.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No polls yet. {canParticipate ? "Create one above." : null}
          </p>
        ) : (
          polls.map((p) => {
            const myVote = address ? p.votes.get(address) : undefined;
            const totalVotes = p.tally.reduce((s, n) => s + n, 0);
            const closed =
              p.deadline !== 0n && BigInt(Math.floor(Date.now() / 1000)) >= p.deadline;
            const canVote = canParticipate && !closed;
            return (
              <div
                key={p.pollId}
                className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-3 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-zinc-900">{p.question}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      by {p.creatorWallet.slice(0, 6)}…{p.creatorWallet.slice(-4)}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                        closed
                          ? "text-red-700 border-red-300 bg-red-50"
                          : "text-emerald-700 border-emerald-300 bg-emerald-50"
                      }`}
                    >
                      {fmtRemaining(p.deadline)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {p.options.map((opt, i) => {
                    const count = p.tally[i] ?? 0;
                    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
                    const mine = myVote === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => canVote && void handleVote(p, i)}
                        disabled={!canVote}
                        className={`relative w-full text-left rounded-lg border px-3 py-2 transition overflow-hidden ${
                          mine
                            ? "border-slate-500 bg-slate-50"
                            : "border-zinc-200 bg-white hover:bg-zinc-50"
                        } ${!canVote ? "cursor-default opacity-90" : ""}`}
                      >
                        <div
                          className={`absolute inset-y-0 left-0 ${
                            mine ? "bg-slate-300/60" : "bg-zinc-100"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            {mine ? (
                              <span className="text-slate-700 text-xs">✓</span>
                            ) : null}
                            <span className="text-zinc-900">{opt}</span>
                          </span>
                          <span className="text-xs text-zinc-700 font-mono">
                            {count} ({pct}%)
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-zinc-500 flex items-center justify-between">
                  <span>
                    {totalVotes} vote{totalVotes === 1 ? "" : "s"} ·{" "}
                    {totalMembers > 0
                      ? `${Math.round((totalVotes / totalMembers) * 100)}% turnout`
                      : ""}
                  </span>
                  {myVote !== undefined ? (
                    <span className="text-slate-700">your vote recorded</span>
                  ) : canVote ? (
                    <span>tap an option to vote</span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
