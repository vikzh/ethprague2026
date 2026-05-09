# PocketChains

**One-tab, group-sized blockchains.** Spin up a private "pocket chain" with a
single Ethereum transaction, invite friends with a QR code, chat with end-to-end
encryption, vote on polls, send each other ETH off-chain via signed cheques,
and settle the net result back to Ethereum when you want to.

No backend. No relayer. No indexer. No custody layer. The whole client runs in
a browser tab — Waku for peer-to-peer messaging, viem/wagmi for the on-chain
side, and a single `ChainPool` contract that anyone can deploy.

> Think Discord-style sub-servers, but the server is a Solidity contract and
> the message bus is a public P2P network.

---

## Highlights

| Capability | How it works |
|---|---|
| **Create a chain in one tx** | `ChainPool.createChain(seedCommit, ttlSeconds)` mints a new ledger namespace inside one shared contract. The seed lives only in the URL fragment of your invite link. |
| **QR / link invites** | Invite URL = `?id=<n>#k=<seed>`. The `#` fragment never leaves the browser, so no server learns the seed. Optional wallet-signed invite envelope for stricter policies. |
| **End-to-end encrypted chat** | Chain-wide AES-GCM key derived from the seed encrypts every channel message. Direct messages use ECDH between ephemeral chat keys + AES-GCM. |
| **Off-chain signed transfers** | EIP-712 `Transfer` cheques flow over Waku and update "effective" balances instantly. Anyone can batch-redeem them on-chain via `applyTransfers`. |
| **Direct withdrawals** | `withdraw(id, amount)` pulls a user's own pool balance back to their wallet — no admin path, no creator role. |
| **Polls** | `poll` and `vote` envelopes signed with the per-chain ephemeral key. Replay tallies them with last-vote-wins per voter; deadlines and membership are enforced. |
| **Poll consensus (per-chain choice)** | Creator picks `one-member-one-vote` (default — every member weighs the same) or `stake-weighted` PoS — voting power equals the voter's current on-chain pool balance. Members with no deposit can still vote in PoS mode but contribute zero weight. |
| **Chain settings (signed by creator)** | EIP-712 `Settings` envelopes carry description, discoverability, invite policy, custom channel definitions, and poll consensus mode. |
| **Custom channels** | Creator-defined channels with `anyone` / `verified` / `creator` write policies (in addition to the built-in `#public` and `#verified`). |
| **Invite policies** | `open` (anyone with the seed), `creator-only` (every join needs the creator's wallet sig), or `member-approved` (any member can mint an invite sig). Replay drops Registers that don't satisfy. |
| **Chain TTL** | Optional expiry stored on-chain. After it passes the contract refuses new deposits and transfer redemptions, but withdrawals stay open so funds can be drained. |
| **Forking** | A "fork" is just a fresh chain whose local metadata records `forkedFrom: <parentId>`. The parent stays untouched; the new chain has its own seed and members. |
| **Encrypted backups** | Download an AES-GCM blob containing the seed, your eph key, the member roster, and the raw envelopes. Decryption requires a wallet signature from the original signer. Restore rehydrates everything into a new browser. |
| **Soft-hide / Discover panel** | A `discoverable: false` setting hides the chain from clients that have cached its settings. The on-chain creation event is permanent and remains visible to fresh clients. |

---

## Repository Layout

```
.
├── README.md                  # this file
├── docs/DEMO.md               # 3-minute live demo script
├── contracts/                 # Foundry workspace
│   ├── src/ChainPool.sol      # the entire on-chain surface
│   ├── test/ChainPool.t.sol   # transfer / nonce / TTL / withdraw tests
│   ├── script/Deploy.s.sol    # broadcasts ChainPool, prints address
│   ├── script/deploy-sepolia.sh
│   └── README.md              # contracts-specific docs
└── app/                       # Next.js 16 + React 19 frontend
    ├── src/app/               # routes: /, /join, /chain/[id], /chain/[id]/fork
    ├── src/components/        # UI (ChainView, FundsPanel, PollPanel, …)
    ├── src/lib/               # protocol code (state replay, eip712, waku, …)
    └── README.md              # app-specific docs
```

---

## Architecture

PocketChains has three planes that the client merges into a single deterministic
view of the world.

```
                           ┌─────────────────────────────┐
            tx (1 per      │   Ethereum Sepolia (or any  │
        create/deposit/    │   EVM)                      │
        sync/withdraw)     │   ┌───────────────────┐     │
            ───────────────┤   │  ChainPool.sol    │     │
                           │   │   chains[id]      │     │
                           │   │   balance[id][a]  │     │
                           │   │   lastNonce[id][a]│     │
                           │   └─────────┬─────────┘     │
                           └─────────────┼───────────────┘
                                         │ events
                                         ▼
   ┌───────────────────────────┐    ┌────────────────────────┐
   │   Waku light node         │    │  Replay engine         │
   │   (in the browser tab)    │───▶│  app/src/lib/state.ts  │
   │   topic = chain id        │    │  (pure function)       │
   │   envelopes:              │    └──────────┬─────────────┘
   │     register, chat,       │               │ ReplayResult
   │     transfer, poll, vote, │               ▼
   │     settings              │    ┌────────────────────────┐
   └───────────────────────────┘    │  React components      │
                                    │  ChainView, Funds,     │
                                    │  Polls, Description    │
                                    └────────────────────────┘
```

### On-chain (`contracts/src/ChainPool.sol`)

A single contract hosts many independent ledgers. Per chain:

- `seedCommit` — `keccak256(abi.encode(seedAddress))` published at create time.
- `creator` — the wallet that ran `createChain`.
- `closed` — manual kill switch.
- `expiresAt` — optional TTL. After it passes `_assertActive` reverts deposits
  and `applyTransfers`; `withdraw` stays open.

Functions:

- `createChain(bytes32 seedCommit, uint64 ttlSeconds) → uint256 id`
- `deposit(uint256 id) payable`
- `applyTransfers(TransferMsg[] txs, bytes[] sigs)` — anyone may submit; each
  cheque is verified, nonce-checked, balance-checked.
- `withdraw(uint256 id, uint256 amount)`
- `close(uint256 id)` — creator-only kill switch.
- `transferDigest(TransferMsg)` / `domainSeparator()` — client helpers.

EIP-712 domain: `name: "PocketChains", version: "1"`. The `Transfer` typehash is
`Transfer(uint256 chainId,address from,address to,uint256 amount,uint64 nonce)`.

### Off-chain envelopes (`app/src/lib/waku.ts`, `app/src/lib/eip712.ts`)

Six envelope types are gossiped over a per-chain Waku content topic
(`/pocketchains/0/chain-<id>/json`):

| Type | Signed by | Purpose |
|---|---|---|
| `register` | wallet (EIP-712 `Register`) + ephemeral key (`JoinProof`) | Binds a wallet to its per-chain chat key. Optionally embeds a `WalletInvite` for non-`open` policies. |
| `chat` | ephemeral key (EIP-712 `Chat`) | Channel or DM message. Body is AES-GCM ciphertext when `contentType === 1`. |
| `transfer` | wallet (EIP-712 `Transfer`) | Off-chain ETH cheque, redeemable by anyone via `applyTransfers`. |
| `poll` | ephemeral key (EIP-712 `Poll`) | Off-chain proposal: question, options, deadline, nonce. |
| `vote` | ephemeral key (EIP-712 `Vote`) | One vote per (poll, wallet); last nonce wins. |
| `settings` | wallet of the on-chain `creator` (EIP-712 `Settings`) | Description, discoverability, invite mode, custom channels, poll consensus mode (`one-member-one-vote` vs `stake-weighted`). Latest valid nonce wins. |

### Replay (`app/src/lib/state.ts`)

A pure function takes:

- the on-chain event log (`Deposited`, `Withdrawn`, `TransferApplied`,
  `ChainCreated`)
- the buffer of Waku envelopes
- an optional viewer context (wallet + eph priv) for DM decryption

…and returns a `ReplayResult` with members, channel chats, polls, settings,
on-chain balances, the queue of pending signed transfers, and effective
balances after pending. Every signature, chain id, nonce, deadline, encryption
key, and policy is checked there — **the UI never trusts raw Waku input.**

### Local persistence (browser-only)

Everything client-side lives in `localStorage`:

- `pc_seed:<chainId>` — the chain seed (the secret in invite URLs).
- `pc_eph:<chainId>:<walletLower>` — your per-chain ephemeral chat key.
- `pc_chains` — list of chains you've visited (for the "My chains" panel).
- `pc_register:<chainId>:<wallet>` — cached signed `Register` envelope, periodically re-gossiped.
- `pc_settings:<chainId>` — cached signed `Settings` envelope (creator only).
- `pc_restored:<chainId>` — envelopes hydrated from an encrypted backup.

---

## Run It

### Requirements

- [Foundry](https://book.getfoundry.sh) (`forge`, `anvil`)
- Node.js 20+ and npm
- A wallet (MetaMask, Rabby, etc.) with some Sepolia ETH if going cross-machine

### Local end-to-end (Anvil)

```bash
# 1. Start a local chain that pretends to be Sepolia
anvil --chain-id 11155111

# 2. Deploy ChainPool
#    Anvil prints 10 test accounts + private keys at startup. Copy one of
#    those keys (NEVER use a real key here) and export it for forge:
cd contracts
export PRIVATE_KEY=<paste an anvil test key from step 1's output>
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
# → ChainPool deployed at: 0x…

# 3. Wire the frontend
cd ../app
cp .env.example .env.local
# edit .env.local:
#   NEXT_PUBLIC_CHAINPOOL_ADDRESS=<address from forge script>
#   NEXT_PUBLIC_CHAIN_ID=11155111
#   NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK=<block from broadcast log>
#   NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
npm install
npm run dev
```

Then point MetaMask at `http://127.0.0.1:8545` (chain id `11155111`) and import
one of Anvil's printed test private keys.

> ⚠️ Anvil keeps state in memory. Restarting it wipes the deployment and any
> chains created in the UI. Use `anvil --state ./anvil-state.json` to persist,
> or be ready to redeploy + clear `pc_*` keys from `localStorage`.

### Public Sepolia

```bash
cd contracts
forge build
forge test
```

Deploy:

```bash
cp .env.example .env
# edit .env with SEPOLIA_RPC_URL and PRIVATE_KEY
./script/deploy.sh sepolia
```

Local Anvil can be used with the same chain id as Sepolia:

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 11155111
```

Verify the local chain id:

```bash
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

The expected result is `0xaa36a7`. Opening `http://127.0.0.1:8545` directly
in a browser may print `Connection header did not include 'upgrade'`; that is
normal because Anvil is a JSON-RPC endpoint, not a web page. Matching the chain
id does not copy Sepolia state. To fork Sepolia, run Anvil with
`--fork-url <SEPOLIA_RPC_URL>` as well.

Deploy to local Anvil:

```bash
cd contracts
./script/deploy.sh local
```

The script prints the `NEXT_PUBLIC_*` values to copy into `app/.env.local`.

App:

```bash
cd app
npm install
npm run dev
```

### Tests

```bash
cd contracts && forge test          # contract suite (transfers, nonces, TTL, withdraw)
cd app       && npm run lint        # ESLint
cd app       && npx tsc --noEmit    # type-check
```

---

Optional Swarm backup uploads and restores:

```bash
./scripts/run-local-bee.sh
```

This starts a local Bee light node through Docker on `http://127.0.0.1:1633`.
After the Bee wallet is funded and has a usable postage batch, set
`BEE_URL` and `BEE_POSTAGE_BATCH_ID` in `app/.env.local`.
Saving a backup to Swarm requires both values. Restoring from an existing Swarm
reference only requires `BEE_URL`.

## Demo Flow

A two-browser, ~3-minute walkthrough lives in [`docs/DEMO.md`](docs/DEMO.md).
The short version:

1. **Wallet A** clicks **Create chain**, picks a TTL/policy, signs one tx.
2. **A** opens the invite QR.
3. **Wallet B** scans, signs **Register**, lands in the chain — both UIs see
   two members within a few seconds (Waku gossip).
4. They chat in `#public` (encrypted with the chain key) and in DMs (ECDH +
   AES-GCM). No wallet popup per message — chat is signed with the per-chain
   ephemeral key.
5. Both deposit some ETH. The pool total updates.
6. **B → A**: signed `Transfer` cheque (typed-data popup, **no tx**). The
   "effective" balance shifts on both sides immediately.
7. Anyone clicks **Sync N to chain** — one tx redeems all pending cheques.
8. **A** withdraws her balance back to her wallet.
9. **A** opens **Polls**, asks a question, both vote, tallies update live.
   In stake-weighted chains, the deposited ETH from step 5 visibly drives
   each voter's bar width.
10. **A** downloads an encrypted backup; another browser can restore the chain
    using the same wallet.

---

## Security Model

### What the contract enforces

- Each `applyTransfers` item: signature recovers to `from`, `nonce > lastNonce`,
  `balance[from] ≥ amount`, chain is active.
- Withdraws come from the caller's own balance only.
- TTL gates deposits and transfer redemptions, not withdrawals.

### What replay enforces (off-chain)

- `Register` requires both a wallet EIP-712 signature **and** an ephemeral-key
  `JoinProof` over the same binding.
- `chat` / `poll` / `vote` must be signed by an ephemeral key bound to a member
  via a verified `Register` (or, for relaxed channels, the eph key is shown
  as a tentative identity).
- Channel write policies (`anyone` / `verified` / `creator`) are checked per
  message based on the latest `settings` envelope.
- Invite policies (`open` / `creator-only` / `member-approved`) are checked at
  Register-acceptance time; the `WalletInvite` signature is recovered against
  the stated `inviter`.
- Polls drop votes after `deadline` and from non-members; per-voter "last
  nonce wins" prevents stuffing.
- Poll tallies use `one-member-one-vote` by default. When `pollMode` is set
  to `stake-weighted` in Settings, each voter's contribution to the tally is
  their current on-chain pool balance (a lightweight PoS) — read live, with
  no snapshot block in v0, so deposits/withdraws during a poll change weight
  on the next replay.
- Settings envelopes are accepted only when signed by the on-chain `creator`
  address; the latest valid nonce wins.

### What it doesn't (yet) do

- The seed in the URL fragment is a **shared symmetric secret**. Anyone who
  has ever held it can decrypt the chain's history. Rotating the chain key is
  not implemented in v0.
- Soft-hide (`discoverable: false`) is enforced client-side; the chain still
  exists on-chain and shows up in Discover for clients that haven't cached
  the settings.
- Invite policies are enforced by the replay engine, not by the contract — a
  malicious peer could still publish unauthorized Registers, but every honest
  client drops them.
- Backup files are AES-GCM with a key derived from a wallet signature; lose
  the wallet, lose the backup.

---

## Tech Stack

**Contracts**
- Solidity 0.8.24, Foundry, OpenZeppelin `EIP712` + `ECDSA`

**App**
- Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- Tailwind CSS 4 (light theme, neutral slate accent)
- wagmi 3 + viem 2 for wallet, contract writes, typed data, and chunked
  `eth_getLogs`
- `@waku/sdk` light node (browser bootstrap, no relay)
- `@noble/secp256k1` for ephemeral keys, ECDH, signatures
- Web Crypto AES-GCM for chain-wide and pairwise message encryption
- `qrcode.react` for invite QR codes

---

## Status

This is a serious prototype with real cryptography and real on-chain
settlement. It's intentionally backendless — every coordination guarantee
comes from a wallet signature, an ephemeral-key signature, the `ChainPool`
contract, or the replay engine. Known constraints are explicit:

- Deployed and tested against Ethereum Sepolia (`chainId = 11155111`); other
  EVM chains work but the frontend is pinned to one.
- Waku store/history can be flaky on cold start; the app re-gossips its own
  Register periodically and the "Publish membership" button is the manual
  fallback.
- Browser `localStorage` is used for prototype-grade key material (seed and
  ephemeral keys). Encrypted backups are the recovery path.
- `discoverable: false` and invite policies are honored only by honest
  clients; on-chain visibility is permanent.

If you want deeper context, the sub-READMEs go into specifics:

- [`contracts/README.md`](contracts/README.md) — contract surface, deployment,
  test suite.
- [`app/README.md`](app/README.md) — frontend modules, configuration, build
  scripts.
