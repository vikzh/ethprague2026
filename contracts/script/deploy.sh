#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
TARGET="${1:-local}"

usage() {
  echo "Usage: ./script/deploy.sh [local|sepolia]" >&2
}

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

case "${TARGET}" in
  local)
    RPC_URL="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
    CHAIN_ID="${CHAIN_ID:-11155111}"
    export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
    VERIFY_FLAG="false"
    ;;
  sepolia)
    if [[ ! -f "${ENV_FILE}" ]]; then
      echo "Missing ${ENV_FILE}. Copy contracts/.env.example to contracts/.env and fill it." >&2
      exit 1
    fi
    if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
      echo "SEPOLIA_RPC_URL is missing in ${ENV_FILE}" >&2
      exit 1
    fi
    if [[ -z "${PRIVATE_KEY:-}" ]]; then
      echo "PRIVATE_KEY is missing in ${ENV_FILE}" >&2
      exit 1
    fi
    RPC_URL="${SEPOLIA_RPC_URL}"
    CHAIN_ID="${CHAIN_ID:-11155111}"
    VERIFY_FLAG="${VERIFY:-false}"
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 1
    ;;
esac

ARGS=(
  script/Deploy.s.sol:Deploy
  --rpc-url "${RPC_URL}"
  --broadcast
)

if [[ "${VERIFY_FLAG}" == "true" ]]; then
  if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
    echo "VERIFY=true requires ETHERSCAN_API_KEY in ${ENV_FILE}" >&2
    exit 1
  fi
  ARGS+=(--verify)
fi

cd "${ROOT_DIR}"

echo "Deploying ChainPool to ${TARGET}..."
echo "RPC URL: ${RPC_URL}"
echo "Chain ID: ${CHAIN_ID}"

forge script "${ARGS[@]}"

RUN_FILE="${ROOT_DIR}/broadcast/Deploy.s.sol/${CHAIN_ID}/run-latest.json"
if [[ ! -f "${RUN_FILE}" ]]; then
  echo "Missing deployment artifact: ${RUN_FILE}" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const runFile = process.argv[1];
const rpcUrl = process.argv[2];
const chainId = process.argv[3];
const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
const tx = run.transactions.find((item) => item.contractName === "ChainPool" && item.contractAddress);
const receipt = run.receipts.find((item) => item.contractAddress);
if (!tx || !receipt) {
  console.error("Could not find ChainPool deployment transaction in artifact.");
  process.exit(1);
}
const rawBlock = receipt.blockNumber;
const block = typeof rawBlock === "string" && rawBlock.startsWith("0x")
  ? BigInt(rawBlock).toString()
  : String(rawBlock);
console.log("");
console.log(`Deployment artifact: ${runFile}`);
console.log("");
console.log("Update app/.env.local:");
console.log(`NEXT_PUBLIC_CHAINPOOL_ADDRESS=${tx.contractAddress}`);
console.log(`NEXT_PUBLIC_CHAIN_ID=${chainId}`);
console.log(`NEXT_PUBLIC_CHAINPOOL_DEPLOY_BLOCK=${block}`);
console.log(`NEXT_PUBLIC_RPC_URL=${rpcUrl}`);
' "${RUN_FILE}" "${RPC_URL}" "${CHAIN_ID}"

