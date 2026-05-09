# Claude Guidance

Repo-level pointer for AI coding agents. Authoritative details live in
[`AGENTS.md`](AGENTS.md), [`app/AGENTS.md`](app/AGENTS.md), and
[`README.md`](README.md). Read those first if you need depth; this file
captures the rules that bite most often.

## What this repo is

PocketChains is a no-backend group-chat / mini-treasury app. Three pieces:

- `contracts/` — Foundry workspace. One `ChainPool.sol` contract holds many
  per-chain ETH ledgers, applies EIP-712 transfer batches, and gates by an
  optional TTL. **Tests live in `contracts/test/ChainPool.t.sol`.**
- `app/` — Next.js 16 + React 19 + TypeScript 5 frontend. Wallet via
  wagmi/viem, P2P messaging via Waku, replay in `src/lib/state.ts`.
- `docs/DEMO.md` — 3-minute live demo script.

## Core invariant: keep these in sync

When you change any of the following, change all of them in the same commit
or you'll silently break signatures and recovery:

- `contracts/src/ChainPool.sol` (Solidity types, EIP-712 typehash)
- `app/src/lib/contract.ts` (ABI, target chain id, deploy block, log range)
- `app/src/lib/eip712.ts` (typed-data schemas, recovery helpers)
- `contracts/test/ChainPool.t.sol` (Foundry tests covering the changes)

Any new field on `SETTINGS_TYPES`, `TRANSFER_TYPES`, `REGISTER_TYPES`,
`POLL_TYPES`, `VOTE_TYPES`, or `INVITE_TYPES` is a typehash bump — old signed
envelopes will be silently dropped on next replay. Document it in the commit
message and in this file's "Schema bumps" section if non-trivial.

## Trust boundary

`app/src/lib/state.ts` is the **only** place where untrusted Waku data
becomes trusted state. Every signature, chain id, nonce, deadline, encryption
key, and policy must be verified there. The UI consumes the resulting
`ReplayResult` and never re-checks. Add new envelope types only by extending
that file's verify functions.

## Where the moving pieces live

- **Replay engine** — `app/src/lib/state.ts` (pure function over
  `(onchainEvents, wakuMessages, viewer, creator)`).
- **State hook** — `app/src/lib/useChainState.ts` (chunked log polling, Waku
  ingest, debounced replay, gossip-republish for cached Register/Settings).
- **Waku envelopes** — `app/src/lib/waku.ts` (factories + light-node
  lifecycle). Topic format: `/pocketchains/0/chain-<id>/json`.
- **Per-chain ephemeral keys** — `app/src/lib/ephemeral.ts` (noble v3
  secp256k1, ECDH for DMs, persisted as `pc_eph:<chainId>:<wallet>`).
- **Chain key (chain-wide AES-GCM)** — `app/src/lib/chainKey.ts`. Derived
  deterministically from the chain seed; chain seed lives in
  `localStorage.pc_seed:<chainId>` and in the URL fragment of invite links.
- **Settings publish** — `app/src/lib/settings.ts` (signs typed data, writes
  cache, mirrors fields into `pc_chains` for instant render).
- **Backups** — `app/src/lib/chainExport.ts` (AES-GCM blob keyed by a wallet
  signature; `restoreFromPayload` rehydrates `pc_*` keys + restored envelopes).

## Conventions that matter

- Anything touching wallets, Waku, browser crypto, or `localStorage` belongs
  behind `"use client"`.
- `eth_getLogs` is always chunked via `getChunkedLogs` in
  `app/src/lib/logs.ts` (`LOGS_BLOCK_RANGE = 800n`). Never call `getLogs`
  with `fromBlock: "earliest"` against a hosted RPC.
- All BigInt math: replay tallies, balances, transfer amounts, poll weights.
  Don't downcast for arithmetic — only for display (`Number()` / `formatEther`).
- Light theme only. Accent color is **slate-600** (`#475569`); do not introduce
  new accent palettes without a design reason. Checkboxes use
  `accent-slate-600`.
- Optimistic UI: every send (chat, vote, settings, transfer) calls
  `addLocalEnvelope` before `waku.publish`, then `useChainState.ingest()`
  dedupes echoes by `envelopeKey()`.
- Don't paste real private keys into docs, examples, or chat. For local
  examples use Anvil's deterministic test mnemonic and tell the user to
  paste a key from Anvil's startup output.

## Verify changes

```bash
# frontend
cd app && npx tsc --noEmit && npm run lint && npm run build

# contracts
cd contracts && forge test && forge fmt --check
```

For UI work, also smoke-test in two browser profiles (different wallets) on
local Anvil — many bugs only surface with multiple signed Registers in flight.

## Recent schema bumps to know about

- `SETTINGS_TYPES` gained `pollMode` (`"one-member-one-vote"` |
  `"stake-weighted"`). Default is `"one-member-one-vote"`. Old Settings
  envelopes signed before this bump will fail recovery and get dropped — the
  creator must re-sign Settings (Description bar → Edit → Save & publish) to
  restore them.

## Things to NOT do

- Don't add a backend or relayer. Every coordination guarantee is meant to
  come from a wallet signature, an ephemeral-key signature, the contract,
  or the replay engine.
- Don't remove the `min-w-0` / `size={1}` on flex `<input>`s in panels — they
  exist to prevent input intrinsic width from blowing past the card border.
- Don't re-introduce the per-message MetaMask popup flow for chat. Chat is
  signed by the per-chain ephemeral key on purpose.
- Don't trust Waku store/history to be complete. Always combine `subscribe`
  + `history` and dedupe via `ingest()`.
- Don't change `LOGS_BLOCK_RANGE` upward without checking RPC compatibility
  (Alchemy free tier caps at ~1k blocks; we use 800 as a safe universal).
- Don't snapshot Anvil state assumptions in tests. Foundry's `setUp()`
  redeploys per test; `useChainState` redeploys on Anvil restart from the
  user's perspective (state in localStorage will dangle).
