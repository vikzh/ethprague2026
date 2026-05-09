# PocketChains

PocketChains turns a wallet group into a live financial workspace in one
transaction.

Create a shared on-chain ledger, invite members with a QR code, coordinate over
Waku, move value with signed off-chain cheques, and settle the net result back
to Ethereum when it matters. No backend. No relayer. No indexer. No custody
layer between the group and the contract.

It feels like opening a private group chat. Under the hood, it is an EIP-712
settlement system with per-chain balances, nonce-protected transfers, encrypted
direct messages, and a contract that anyone can use to redeem valid signed
payments.

## Why It Matters

Most crypto group flows are still painfully heavy: create a multisig, configure
roles, send every small payment on-chain, wait for infrastructure, and hope the
backend stays alive. PocketChains compresses that into a single contract call
and a browser session.

- **Instant group formation**: one `createChain` transaction creates a fresh
  ledger namespace.
- **QR-native onboarding**: invite links carry the join secret in the URL
  fragment, keeping it out of server requests.
- **Free coordination layer**: Waku carries signed membership, chat, and payment
  intent without an application backend.
- **Off-chain payments, on-chain finality**: members sign EIP-712 transfer
  cheques immediately; anyone can batch-settle them through `applyTransfers`.
- **Direct exits**: users withdraw their own on-chain balances from the pool
  without an admin path.
- **Private member messaging**: direct messages use ephemeral keys, ECDH, and
  AES-GCM in the browser.

PocketChains is not trying to make another wallet UI. It makes group money feel
native to real-time coordination.

## Repository

- `app/`: Next.js frontend with wallet, Waku, replay, chat, and settlement UI.
- `contracts/`: Foundry project containing the `ChainPool` Solidity contract.
- `docs/DEMO.md`: timed demo script.

## Architecture

`ChainPool` is the settlement core. It stores many independent ledgers in one
contract. Each ledger tracks:

- seed commitment and creator
- closed/open status
- per-user ETH balances
- last settled transfer nonce per sender

The app reconstructs live state by combining on-chain events with signed Waku
envelopes. Waku data is treated as untrusted input: signatures, chain ids,
membership bindings, and transfer nonces are verified before replay.

## Run It

Contracts:

```bash
cd contracts
forge build
forge test
```

Deploy:

```bash
cp .env.example .env
# edit .env with SEPOLIA_RPC_URL and PRIVATE_KEY
chmod +x script/deploy-sepolia.sh
./script/deploy-sepolia.sh
```

App:

```bash
cd app
npm install
cp .env.example .env.local
```

Set:

```bash
NEXT_PUBLIC_CHAINPOOL_ADDRESS=<deployed-chainpool-address>
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK=<deployment-block>
NEXT_PUBLIC_RPC_URL=<optional-rpc-url>
```

Use the same Sepolia RPC URL for `NEXT_PUBLIC_RPC_URL` that you used as
`SEPOLIA_RPC_URL` during deployment. Get `NEXT_PUBLIC_CHAINPOOL_ADDRESS` and
`NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK` from
`contracts/broadcast/Deploy.s.sol/11155111/run-latest.json` after deployment.

Start:

```bash
npm run dev
```

Open `http://localhost:3000`.

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

1. Create a chain.
2. Share the invite QR.
3. A second wallet accepts and publishes membership.
4. Members chat publicly, use the verified channel, or open encrypted DMs.
5. Members deposit ETH.
6. Members sign off-chain transfers.
7. Anyone syncs pending transfers to the contract.
8. Users withdraw their on-chain balances directly.

## Status

This is a serious prototype with real cryptographic flows and on-chain
settlement, built for fast iteration. It intentionally avoids backend custody
and relayer assumptions. Current constraints are explicit: Sepolia is configured
in the frontend, Waku public history can be inconsistent, and browser local
storage is used for prototype key material.
