import type { Address } from "viem";

export const CHAINPOOL_ADDRESS = (process.env.NEXT_PUBLIC_CHAINPOOL_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

export const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);

export const CHAINPOOL_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK ?? "0",
);

export const IS_CONTRACT_CONFIGURED =
  CHAINPOOL_ADDRESS.toLowerCase() !==
  "0x0000000000000000000000000000000000000000";

/** Max block range per eth_getLogs request.
 * Alchemy's free Sepolia tier currently caps this at 10 blocks. */
export const LOGS_BLOCK_RANGE = 10n;

export const CHAINPOOL_ABI = [
  {
    type: "function",
    name: "createChain",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seedCommit", type: "bytes32" },
      { name: "ttlSeconds", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "applyTransfers",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "txs",
        type: "tuple[]",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint64" },
        ],
      },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "close",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balance",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastNonce",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "chains",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "seedCommit", type: "bytes32" },
      { name: "creator", type: "address" },
      { name: "closed", type: "bool" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "nextChainId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transferDigest",
    stateMutability: "view",
    inputs: [
      {
        name: "t",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint64" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "ChainCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "seedCommit", type: "bytes32", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TransferApplied",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "nonce", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Closed",
    inputs: [{ name: "id", type: "uint256", indexed: true }],
    anonymous: false,
  },
] as const;
