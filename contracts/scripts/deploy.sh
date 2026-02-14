#!/bin/bash
set -e

echo "=== Nest Markets Deployment ==="
echo ""

# Configuration
NETWORK="${NETWORK:-testnet}"
ORACLE="${ORACLE:-nest-oracle-3.testnet}"
USDC="${USDC:-nusd-token-1.testnet}"

echo "Network: $NETWORK"
echo "Oracle:  $ORACLE"
echo "USDC:    $USDC"
echo ""

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
OUTCOME_TOKEN_ID="${OUTCOME_TOKEN_ID:-outcome-token-1.testnet}"
near deploy "$OUTCOME_TOKEN_ID" \
    target/near/outcome_token/outcome_token.wasm \
    --network-id "$NETWORK" \
    || echo "Deploy outcome-token manually"

echo ""
echo "=== Deploying Market Contract ==="
MARKET_ID="${MARKET_ID:-nest-market-1.testnet}"
near deploy "$MARKET_ID" \
    target/near/market_contract/market_contract.wasm \
    --network-id "$NETWORK" \
    || echo "Deploy market manually"

echo ""
echo "=== Initializing Outcome Token ==="
near call "$OUTCOME_TOKEN_ID" new \
    "{\"market_contract\": \"$MARKET_ID\"}" \
    --accountId "$OUTCOME_TOKEN_ID" \
    --network-id "$NETWORK" \
    || echo "Init outcome-token manually"

echo ""
echo "=== Initializing Market Contract ==="
near call "$MARKET_ID" new \
    "{\"owner\": \"$MARKET_ID\", \"usdc_token\": \"$USDC\", \"outcome_token\": \"$OUTCOME_TOKEN_ID\", \"oracle\": \"$ORACLE\"}" \
    --accountId "$MARKET_ID" \
    --network-id "$NETWORK" \
    || echo "Init market manually"

echo ""
echo "=== Deployment Complete ==="
echo "Outcome Token: $OUTCOME_TOKEN_ID"
echo "Market:        $MARKET_ID"
echo "Oracle:        $ORACLE"
echo "USDC:          $USDC"
