# PocketChains App

Production-shaped Next.js client for operating PocketChains ledgers: wallet
connection, chain discovery, Waku membership, signed messaging, encrypted DMs,
off-chain transfer authoring, on-chain batch settlement, deposits, and
withdrawals.

## Technical Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4
- wagmi and viem for wallet, contract writes, typed data, and log reads
- Waku light node for `register`, `chat`, and `transfer` envelopes
- EIP-712 for wallet-bound `Register` and `Transfer` messages
- `@noble/secp256k1` for per-chain ephemeral keys, chat signatures, and ECDH
- AES-GCM for browser-side direct-message encryption

## Runtime Configuration

```bash
npm install
cp .env.example .env.local
```

Required:

```bash
NEXT_PUBLIC_CHAINPOOL_ADDRESS=<deployed-chainpool-address>
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK=<deployment-block>
NEXT_PUBLIC_RPC_URL=<optional-rpc-url>
```

`NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK` is used as the first block for chunked
event scans. Keep it close to the deployment block to reduce RPC load.

## Run

```bash
npm run dev
npm run build
npm run lint
```

## Core Modules

- `src/lib/contract.ts`: `ChainPool` address, target chain id, ABI, log range.
- `src/lib/eip712.ts`: typed-data domains, message schemas, recovery helpers.
- `src/lib/waku.ts`: Waku node lifecycle, content topic, envelope encoding.
- `src/lib/state.ts`: deterministic replay and validation boundary.
- `src/lib/useChainState.ts`: on-chain log polling, Waku ingestion, replay loop.
- `src/lib/ephemeral.ts`: secp256k1 key generation, ECDH, local key storage.
- `src/components/FundsPanel.tsx`: deposit, sign transfer, sync, withdraw UI.
- `src/components/ChainView.tsx`: channel, member, DM, invite, and funds shell.

## State Model

The app merges two data planes:

- **On-chain**: `Deposited`, `Withdrawn`, and `TransferApplied` events from
  `ChainPool`.
- **Off-chain**: Waku envelopes for membership registration, chat, and pending
  transfer cheques.

Replay verifies signatures before accepting data. Pending transfers are filtered
against the last settled sender nonce and sorted by `(from, nonce)` because the
contract reverts on stale or out-of-order submissions.

## Contract Coupling

Keep these files synchronized with `../contracts/src/ChainPool.sol`:

- `src/lib/contract.ts`
- `src/lib/eip712.ts`
- `src/components/FundsPanel.tsx`

If `TransferMsg`, the EIP-712 domain, or events change, update the app and the
Foundry tests in the same change.
