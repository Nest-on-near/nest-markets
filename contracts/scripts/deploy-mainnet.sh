#!/usr/bin/env bash
set -euo pipefail

# Mainnet wrapper for markets deployment.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NETWORK="${NETWORK_PROFILE:-mainnet-fastnear}"

required=(
  OWNER
  ORACLE
  USDC
  MARKET_ID
  OUTCOME_TOKEN_ID
)

for var in "${required[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

check_mainnet_id() {
  local name="$1"
  local value="$2"
  if [[ "$value" == *.testnet ]]; then
    echo "Error: $name cannot end with .testnet for mainnet deploy: $value" >&2
    exit 1
  fi
  if [[ "$value" == *.mainnet ]]; then
    echo "Error: $name cannot end with .mainnet (invalid NEAR account suffix): $value" >&2
    exit 1
  fi
}

check_mainnet_id OWNER "$OWNER"
check_mainnet_id ORACLE "$ORACLE"
check_mainnet_id USDC "$USDC"
check_mainnet_id MARKET_ID "$MARKET_ID"
check_mainnet_id OUTCOME_TOKEN_ID "$OUTCOME_TOKEN_ID"

echo "Running mainnet markets deployment with:"
echo "  OWNER=$OWNER"
echo "  ORACLE=$ORACLE"
echo "  USDC=$USDC"
echo "  MARKET_ID=$MARKET_ID"
echo "  OUTCOME_TOKEN_ID=$OUTCOME_TOKEN_ID"
echo

"$SCRIPT_DIR/deploy.sh"
