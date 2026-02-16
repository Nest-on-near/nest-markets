#!/usr/bin/env bash
set -euo pipefail

# Emergency recovery helper for nest-markets market contract.
# Calls owner-only emergency withdrawal methods.

NETWORK="${NETWORK:-mainnet}"
OWNER_ACCOUNT="${OWNER_ACCOUNT:-}"
TREASURY_ACCOUNT="${TREASURY_ACCOUNT:-}"
MARKET_ID="${MARKET_ID:-}"
COLLATERAL_TOKEN="${COLLATERAL_TOKEN:-}"

MARKET_WITHDRAW_TOKEN_AMOUNT="${MARKET_WITHDRAW_TOKEN_AMOUNT:-0}"
MARKET_WITHDRAW_NEAR_YOCTO="${MARKET_WITHDRAW_NEAR_YOCTO:-0}"

require_env() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

near_tx() {
  local contract="$1"
  local method="$2"
  local json_args="$3"
  local signer="$4"
  local gas="${5:-80 Tgas}"
  local deposit="${6:-0 NEAR}"

  echo "+ near contract call-function as-transaction $contract $method ..."
  near contract call-function as-transaction "$contract" "$method" \
    json-args "$json_args" \
    prepaid-gas "$gas" \
    attached-deposit "$deposit" \
    sign-as "$signer" \
    network-config "$NETWORK" \
    sign-with-keychain send
}

require_env "OWNER_ACCOUNT" "$OWNER_ACCOUNT"
require_env "TREASURY_ACCOUNT" "$TREASURY_ACCOUNT"
require_env "MARKET_ID" "$MARKET_ID"

if [[ "$MARKET_WITHDRAW_TOKEN_AMOUNT" != "0" ]]; then
  require_env "COLLATERAL_TOKEN" "$COLLATERAL_TOKEN"
  near_tx "$MARKET_ID" "emergency_withdraw_token" \
    "{\"token\":\"$COLLATERAL_TOKEN\",\"receiver_id\":\"$TREASURY_ACCOUNT\",\"amount\":\"$MARKET_WITHDRAW_TOKEN_AMOUNT\"}" \
    "$OWNER_ACCOUNT" "120 Tgas" "1 yoctoNEAR"
fi

if [[ "$MARKET_WITHDRAW_NEAR_YOCTO" != "0" ]]; then
  near_tx "$MARKET_ID" "emergency_withdraw_near" \
    "{\"receiver_id\":\"$TREASURY_ACCOUNT\",\"amount\":\"$MARKET_WITHDRAW_NEAR_YOCTO\"}" \
    "$OWNER_ACCOUNT" "80 Tgas" "0 NEAR"
fi

echo "Market emergency recovery calls complete."
