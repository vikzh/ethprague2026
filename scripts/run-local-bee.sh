#!/usr/bin/env bash
set -euo pipefail

# Local Bee node for PocketChains Swarm backup uploads.
#
# Defaults follow Swarm's Docker guidance:
# - bind the Bee HTTP API to 127.0.0.1:1633, not the public internet
# - run a light node, which supports uploads/downloads
# - use the Fair Data Society Gnosis archive RPC unless overridden
#
# Override any setting by exporting it before running this script, for example:
#   BEE_BLOCKCHAIN_RPC_ENDPOINT=https://your-gnosis-archive-rpc ./scripts/run-local-bee.sh

BEE_CONTAINER_NAME="${BEE_CONTAINER_NAME:-pocketchains-bee}"
BEE_IMAGE="${BEE_IMAGE:-ethersphere/bee:2.6.0}"
BEE_API_HOST="${BEE_API_HOST:-127.0.0.1}"
BEE_API_PORT="${BEE_API_PORT:-1633}"
BEE_P2P_PORT="${BEE_P2P_PORT:-1634}"
BEE_DATA_VOLUME="${BEE_DATA_VOLUME:-pocketchains-bee-data}"
BEE_PASSWORD="${BEE_PASSWORD:-pocketchains-local-bee-password-change-me}"
BEE_BLOCKCHAIN_RPC_ENDPOINT="${BEE_BLOCKCHAIN_RPC_ENDPOINT:-https://xdai.fairdatasociety.org}"
BEE_FULL_NODE="${BEE_FULL_NODE:-false}"
BEE_SWAP_ENABLE="${BEE_SWAP_ENABLE:-true}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run Bee locally. Install Docker Desktop or Docker Engine first." >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$BEE_CONTAINER_NAME"; then
  echo "Bee container '$BEE_CONTAINER_NAME' is already running."
elif docker ps -a --format '{{.Names}}' | grep -Fxq "$BEE_CONTAINER_NAME"; then
  echo "Starting existing Bee container '$BEE_CONTAINER_NAME'..."
  docker start "$BEE_CONTAINER_NAME" >/dev/null
else
  echo "Creating Bee container '$BEE_CONTAINER_NAME'..."
  docker run -d \
    --name "$BEE_CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${BEE_API_HOST}:${BEE_API_PORT}:1633" \
    -p "${BEE_P2P_PORT}:1634" \
    -e BEE_API_ADDR=":1633" \
    -e BEE_FULL_NODE="$BEE_FULL_NODE" \
    -e BEE_SWAP_ENABLE="$BEE_SWAP_ENABLE" \
    -e BEE_PASSWORD="$BEE_PASSWORD" \
    -e BEE_BLOCKCHAIN_RPC_ENDPOINT="$BEE_BLOCKCHAIN_RPC_ENDPOINT" \
    -v "${BEE_DATA_VOLUME}:/home/bee/.bee" \
    "$BEE_IMAGE" start >/dev/null
fi

BEE_URL="http://${BEE_API_HOST}:${BEE_API_PORT}"

echo "Waiting for Bee API at ${BEE_URL}..."
for _ in $(seq 1 60); do
  if curl -fsS "${BEE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "${BEE_URL}/health" >/dev/null 2>&1; then
  echo "Bee API did not become ready. Check logs with:" >&2
  echo "  docker logs -f ${BEE_CONTAINER_NAME}" >&2
  exit 1
fi

echo
echo "Bee is running."
echo "API URL for app/.env.local:"
echo "  BEE_URL=${BEE_URL}"
echo
echo "Node mode:"
curl -fsS "${BEE_URL}/node" || true
echo
echo
echo "Wallet/address info:"
curl -fsS "${BEE_URL}/addresses" || true
echo
echo
echo "Existing postage batches:"
curl -fsS "${BEE_URL}/stamps" || true
echo
echo
echo "Next steps:"
echo "  1. Fund the Bee node wallet with xBZZ on Gnosis Chain."
echo "  2. Buy or select a usable postage batch."
echo "  3. Put these values in app/.env.local:"
echo "       BEE_URL=${BEE_URL}"
echo "       BEE_POSTAGE_BATCH_ID=<usable batchID from ${BEE_URL}/stamps>"
echo
echo "Logs:"
echo "  docker logs -f ${BEE_CONTAINER_NAME}"
