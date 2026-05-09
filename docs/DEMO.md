# 3-minute live demo script

Two laptops (or two browser profiles on one) — call them **A** and **B**.

## Prep (before going on stage)

1. Contract deployed on Ethereum Sepolia, or local Anvil running with Sepolia's
   chain id:

   ```bash
   anvil --host 127.0.0.1 --port 8545 --chain-id 11155111
   ```

   Use `--fork-url <SEPOLIA_RPC_URL>` too if the demo needs Sepolia state.
2. `app/.env.local` filled in on both machines.
3. Both wallets funded with a tiny amount of test ETH.
4. `npm run dev` running on both.

## The 3 minutes

| t (s) | Step | What happens visibly |
|---|---|---|
| 0–15 | A: connect wallet → "Create chain" | One tx popup. Chain page opens. Member list shows 1. |
| 15–30 | A: "Show invite QR" | QR appears with a `?id=N#k=…` URL. The fragment never hits a server. |
| 30–60 | B: scan QR (camera or paste link) → connect wallet → "Accept invite" | One wallet message. Page redirects to `/chain/N`. Member list now shows 2 on both sides within a couple seconds (Waku gossip). |
| 60–90 | A and B chat in `#public` | Messages appear instantly. Note: no wallet popup per message — chat is signed with the per-chain ephemeral key. |
| 90–120 | A: Deposit 0.005 ETH; B: Deposit 0.003 ETH | Two txs (one each). "Pool total" updates to 0.008. Each user sees their own on-chain balance. |
| 120–150 | B → A: signed Transfer 0.002. A → B: signed Transfer 0.001 | Wallet shows EIP-712 typed data prompt — **no tx**. Pending list shows 2 transfers. "Effective" balances shift instantly on both sides. |
| 150–180 | A (or anyone) clicks "Sync 2 to chain" | One tx redeems both cheques. `Pool total` unchanged; per-user `on-chain` balances now match `effective`. |
| 180+ | A withdraws part of her balance | One tx. ETH lands back in her wallet. |

## Lines to say

- *"This is a Discord-style sub-chain. Joining is one signature. Messaging is free. Sending money is a signed cheque, not a transaction."*
- *"Watch — Bob signs a payment to Alice, no tx, but Alice sees the balance shift the moment Waku delivers the cheque."*
- *"Anyone can hit Sync. The contract verifies the signatures and moves the money. No creator role, no admin, no proofs."*
- *"Alice withdraws her balance straight from the pool. One line of Solidity. We never built a Merkle tree, we never built a relayer, we never wrote a backend."*

## If something breaks on stage

- **Waku peer takes a moment**: chat may lag for ~5s on first message. Lead with the on-chain create + deposit; come back to chat once it's warm.
- **MetaMask wrong chain**: header shows a yellow "Switch to Sepolia" button.
- **Sync reverts**: usually means a sender's pending nonce was double-signed or onchain nonce moved. Refresh — replay deduplicates.
