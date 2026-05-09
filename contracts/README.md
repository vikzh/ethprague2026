# PocketChains Contracts

Foundry workspace for the on-chain settlement layer behind PocketChains.

The contract system is intentionally small: one `ChainPool` contract hosts many
independent ledger namespaces. The frontend and Waku layer handle discovery,
membership gossip, chat, and transfer intent; the contract enforces custody,
balances, signature validity, nonce monotonicity, and withdrawal rights.

## Contents

- `src/ChainPool.sol`: core settlement contract.
- `test/ChainPool.t.sol`: Foundry tests for create, deposit, transfer apply,
  nonce replay protection, balance checks, close behavior, and EIP-712 digest
  compatibility.
- `script/Deploy.s.sol`: deployment script that broadcasts `ChainPool` and logs
  the contract address plus domain separator.
- `foundry.toml`: compiler, remapping, Sepolia RPC, and Etherscan settings.

Generated folders such as `out`, `cache`, and `broadcast` are build/deployment
artifacts, not source.

## ChainPool

`ChainPool` maps many pocket-chain ids to independent ETH ledgers.

Per chain:

- `seedCommit`: commitment used by the app invite flow.
- `creator`: wallet that created the chain.
- `closed`: blocks future deposits when set.
- `balance[id][wallet]`: withdrawable ETH balance inside that chain.
- `lastNonce[id][wallet]`: highest settled transfer nonce for each sender.

Main functions:

- `createChain(bytes32 seedCommit) returns (uint256 id)`: creates a new ledger.
- `deposit(uint256 id) payable`: credits `msg.sender` inside an open chain.
- `applyTransfers(TransferMsg[] txs, bytes[] sigs)`: verifies EIP-712 transfer
  signatures and applies a batch of off-chain cheques.
- `withdraw(uint256 id, uint256 amount)`: sends a user-owned balance back to
  `msg.sender`.
- `close(uint256 id)`: lets the creator stop future deposits.
- `transferDigest(TransferMsg t)`: client/test helper for the exact digest used
  by `applyTransfers`.
- `domainSeparator()`: exposes the EIP-712 domain separator.

## Transfer Security Model

Transfers are signed off-chain as:

```solidity
Transfer(uint256 chainId,address from,address to,uint256 amount,uint64 nonce)
```

`applyTransfers` enforces:

- batch length matches signature length
- recovered signer equals `from`
- `nonce > lastNonce[chainId][from]`
- sender has enough on-chain pool balance
- balances are updated before nonce advancement is emitted

Anyone may submit a valid batch. Submitters should sort by sender and nonce
ascending, because a stale nonce causes the whole call to revert.

## Commands

```bash
forge build
forge test
forge fmt
forge snapshot
```

Deploy to Sepolia:

```bash
export SEPOLIA_RPC_URL=<rpc-url>
export PRIVATE_KEY=<hex-private-key>
forge script script/Deploy.s.sol:Deploy --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Optional verification, if `ETHERSCAN_API_KEY` is configured:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  --verify
```

After deployment, copy the contract address and deployment block into
`../app/.env.local` as `NEXT_PUBLIC_CHAINPOOL_ADDRESS` and
`NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK`.
