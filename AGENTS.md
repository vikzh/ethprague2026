# Repository Guidance

## Structure

- `app/`: Next.js 16 frontend for PocketChains.
- `contracts/`: Foundry project containing `ChainPool`.
- `docs/`: demo and supporting project notes.

## Product Model

PocketChains lets users create small group chains backed by one Solidity
contract. The app uses Waku for signed register, chat, and transfer envelopes.
ETH deposits, withdrawals, and settled transfer batches are handled by
`contracts/src/ChainPool.sol`.

## Development

- For frontend work, read `app/AGENTS.md` first.
- Keep the frontend ABI in `app/src/lib/contract.ts` synchronized with
  `contracts/src/ChainPool.sol`.
- If EIP-712 fields change, update the Solidity contract, contract tests, and
  `app/src/lib/eip712.ts` together.
- Generated Foundry output in `contracts/out`, `contracts/cache`, and
  `contracts/broadcast` should not be treated as source.

## Verification

Frontend:

```bash
cd app
npm run lint
npm run build
```

Contracts:

```bash
cd contracts
forge test
```
