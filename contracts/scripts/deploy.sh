#!/bin/bash
set -euo pipefail

echo "=== Nest Markets Deployment ==="
echo ""

# Configuration
NETWORK="${NETWORK:-testnet}"
ORACLE="${ORACLE:-nest-oracle-7.testnet}"
USDC="${USDC:-nusd-1.testnet}"
OWNER="${OWNER:-}"
OUTCOME_TOKEN_ID="${OUTCOME_TOKEN_ID:-outcome-token-1.testnet}"
MARKET_ID="${MARKET_ID:-nest-market-1.testnet}"
STEP_SLEEP_SECONDS="${STEP_SLEEP_SECONDS:-10}"

if [[ -z "${OWNER}" ]]; then
  echo "Missing required env var: OWNER"
  echo "Example: OWNER=your-admin.testnet NETWORK=testnet ORACLE=... USDC=... MARKET_ID=... OUTCOME_TOKEN_ID=... ./scripts/deploy.sh"
  exit 1
fi

echo "Network: $NETWORK"
echo "Oracle:  $ORACLE"
echo "USDC:    $USDC"
echo "Owner:   $OWNER"
echo "Step delay: ${STEP_SLEEP_SECONDS}s"
echo ""

run_cmd() {
  echo "+ $*"
  "$@"
}

sleep_step() {
  if [[ "${STEP_SLEEP_SECONDS}" =~ ^[0-9]+$ ]] && [[ "${STEP_SLEEP_SECONDS}" -gt 0 ]]; then
    sleep "${STEP_SLEEP_SECONDS}"
  fi
}

deploy_contract() {
  local account_id="$1"
  local wasm_path="$2"
  run_cmd near contract deploy "$account_id" use-file "$wasm_path" without-init-call \
    network-config "$NETWORK" sign-with-keychain send
}

near_tx() {
  local contract="$1"
  local method="$2"
  local args_json="$3"
  local signer="$4"
  local gas="${5:-80 Tgas}"
  local deposit="${6:-0 NEAR}"

  run_cmd near contract call-function as-transaction "$contract" "$method" \
    json-args "$args_json" \
    prepaid-gas "$gas" \
    attached-deposit "$deposit" \
    sign-as "$signer" \
    network-config "$NETWORK" \
    sign-with-keychain send
}

# Build contracts (requires cargo-near and Rust 1.86 toolchain)
echo "Building contracts..."
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for contract in outcome-token market; do
    echo "  Building $contract..."
    (cd "$contract" && cargo near build non-reproducible-wasm --no-abi)
done

echo ""
echo "=== Deploying Outcome Token Contract ==="
deploy_contract "$OUTCOME_TOKEN_ID" "target/near/outcome_token/outcome_token.wasm"
sleep_step

echo ""
echo "=== Deploying Market Contract ==="
deploy_contract "$MARKET_ID" "target/near/market_contract/market_contract.wasm"
sleep_step

echo ""
echo "=== Initializing Outcome Token ==="
near_tx "$OUTCOME_TOKEN_ID" new "{\"market_contract\":\"$MARKET_ID\"}" "$OWNER" "80 Tgas" "0 NEAR"
sleep_step

echo ""
echo "=== Initializing Market Contract ==="
near_tx "$MARKET_ID" new "{\"owner\":\"$OWNER\",\"usdc_token\":\"$USDC\",\"outcome_token\":\"$OUTCOME_TOKEN_ID\",\"oracle\":\"$ORACLE\"}" "$OWNER" "80 Tgas" "0 NEAR"
sleep_step

echo ""
echo "=== Deployment Complete ==="
echo "Outcome Token: $OUTCOME_TOKEN_ID"
echo "Market:        $MARKET_ID"
echo "Oracle:        $ORACLE"
echo "USDC:          $USDC"
