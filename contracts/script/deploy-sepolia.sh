#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy contracts/.env.example to contracts/.env and fill it." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
  echo "SEPOLIA_RPC_URL is missing in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "PRIVATE_KEY is missing in ${ENV_FILE}" >&2
  exit 1
fi

ARGS=(
  script/Deploy.s.sol:Deploy
  --rpc-url "${SEPOLIA_RPC_URL}"
  --broadcast
)

if [[ "${VERIFY:-false}" == "true" ]]; then
  if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
    echo "VERIFY=true requires ETHERSCAN_API_KEY in ${ENV_FILE}" >&2
    exit 1
  fi
  ARGS+=(--verify)
fi

cd "${ROOT_DIR}"
forge script "${ARGS[@]}"

RUN_FILE="${ROOT_DIR}/broadcast/Deploy.s.sol/11155111/run-latest.json"
if [[ -f "${RUN_FILE}" ]]; then
  echo
  echo "Deployment artifact: ${RUN_FILE}"
  echo "Use the contractAddress and receipt blockNumber from that file in app/.env.local."
fi
