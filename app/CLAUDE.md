# Claude Guidance

Follow `AGENTS.md` in this directory. The high-level shape:

- This is a Next.js 16 App Router frontend for the PocketChains `ChainPool`
  contract in `../contracts`.
- Keep Waku, wallet hooks, local storage, crypto, and browser APIs in client
  components/modules.
- Keep `src/lib/contract.ts`, `src/lib/eip712.ts`, and
  `../contracts/src/ChainPool.sol` synchronized when contract interfaces or
  typed data change.
- Treat `src/lib/state.ts` as the validation/replay boundary for untrusted Waku
  envelopes.
- Verify with `npm run lint` and `npm run build`; run `forge test` in
  `../contracts` for contract-coupled work.
