<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This app uses Next.js 16, React 19, and the App Router. These versions may have
APIs and conventions that differ from older training data. When changing Next.js
behavior, check the installed documentation in `node_modules/next/dist/docs/`
or the current package docs before assuming legacy behavior.
<!-- END:nextjs-agent-rules -->

# Project Guidance

## Product

PocketChains is a no-backend demo for tiny group chains. The frontend lets users
create a `ChainPool` chain, share an invite QR, publish signed membership over
Waku, chat in channels or encrypted DMs, deposit ETH, sign off-chain transfer
cheques, batch-settle those cheques on-chain, and withdraw balances.

## Important Paths

- `src/app/page.tsx`: home shell.
- `src/app/chain/[id]/page.tsx`: chain route.
- `src/app/join/page.tsx`: invite accept flow.
- `src/components/ChainView.tsx`: main chain UI.
- `src/components/FundsPanel.tsx`: deposit, off-chain transfer, sync, withdraw.
- `src/lib/contract.ts`: contract address, target chain id, ABI, log settings.
- `src/lib/eip712.ts`: typed data definitions and signature recovery helpers.
- `src/lib/state.ts`: replay/validation of Waku envelopes and on-chain events.
- `src/lib/useChainState.ts`: Waku setup, log polling, replay orchestration.
- `src/lib/waku.ts`: Waku light node wrapper and envelope factories.

## Local Setup

Use `npm` in this directory.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required public environment:

- `NEXT_PUBLIC_CHAINPOOL_ADDRESS`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK`
- `NEXT_PUBLIC_RPC_URL` is optional but recommended for reliable log scans.

## Development Rules

- Keep wallet, contract, and Waku code client-only. Files that touch browser
  APIs, wagmi hooks, Waku, or local storage should stay behind `"use client"`.
- Keep `CHAINPOOL_ABI` synchronized with `contracts/src/ChainPool.sol`.
- If `ChainPool` EIP-712 domain fields or `TransferMsg` fields change, update
  both `src/lib/eip712.ts` and contract tests.
- `state.ts` is the trust boundary for Waku data. Validate signatures and chain
  ids there before adding data to replay state.
- Do not assume Waku store history is complete. The app intentionally caches and
  republishes register envelopes.
- Local storage currently holds chain labels, invite seeds, signed register
  envelopes, and ephemeral chat private keys. Treat that as prototype behavior.
- On-chain log reads are chunked by `LOGS_BLOCK_RANGE`; avoid unbounded
  `getLogs` calls over large ranges.

## Verification

Before handing off frontend changes, run:

```bash
npm run lint
npm run build
```

For contract-coupled changes, also run from `../contracts`:

```bash
forge test
```
