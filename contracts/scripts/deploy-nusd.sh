#!/bin/bash
set -euo pipefail

echo "=== Deploy nUSD (Mock FT) ==="
echo ""

NETWORK="${NETWORK:-testnet}"
NUSD_ID="${NUSD_ID:-nusd-token-1.testnet}"
OWNER_ID="${OWNER_ID:-$NUSD_ID}"
MARKET_ID="${MARKET_ID:-nest-market-1.testnet}"
USER_ID="${USER_ID:-}"
MINT_USER_AMOUNT="${MINT_USER_AMOUNT:-5000000000}" # 5000 nUSD (6 decimals)

echo "Network:   $NETWORK"
echo "nUSD ID:   $NUSD_ID"
echo "Owner ID:  $OWNER_ID"
echo "Market ID: $MARKET_ID"
if [[ -n "$USER_ID" ]]; then
  echo "User ID:   $USER_ID"
fi
echo ""

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building mock-ft..."
(cd mock-ft && cargo near build non-reproducible-wasm --no-abi)

echo ""
echo "Deploying nUSD contract..."
near deploy "$NUSD_ID" \
  target/near/mock_ft/mock_ft.wasm \
  --network-id "$NETWORK"

echo ""
echo "Initializing nUSD contract..."
near call "$NUSD_ID" new \
  "{\"owner\":\"$OWNER_ID\",\"total_supply\":\"0\"}" \
  --accountId "$OWNER_ID" \
  --network-id "$NETWORK" \
  || echo "Init likely already done; continuing."

echo ""
echo "Registering market account on nUSD..."
near call "$NUSD_ID" storage_deposit \
  "{\"account_id\":\"$MARKET_ID\"}" \
  --accountId "$OWNER_ID" \
  --depositYocto 1250000000000000000000 \
  --network-id "$NETWORK" \
  || echo "Market storage already registered; continuing."

if [[ -n "$USER_ID" ]]; then
  echo ""
  echo "Registering user account on nUSD..."
  near call "$NUSD_ID" storage_deposit \
    "{\"account_id\":\"$USER_ID\"}" \
    --accountId "$USER_ID" \
    --depositYocto 1250000000000000000000 \
    --network-id "$NETWORK" \
    || echo "User storage already registered; continuing."

  echo ""
  echo "Minting nUSD to user..."
  near call "$NUSD_ID" mint \
    "{\"account_id\":\"$USER_ID\",\"amount\":\"$MINT_USER_AMOUNT\"}" \
    --accountId "$OWNER_ID" \
    --network-id "$NETWORK"

  echo ""
  echo "User nUSD balance:"
  near view "$NUSD_ID" ft_balance_of "{\"account_id\":\"$USER_ID\"}" --network-id "$NETWORK"
fi

echo ""
echo "nUSD metadata:"
near view "$NUSD_ID" ft_metadata '{}' --network-id "$NETWORK"

echo ""
echo "=== nUSD Deployment Complete ==="
echo "Set this for contracts/UI:"
echo "  USDC=$NUSD_ID"
echo "  NEXT_PUBLIC_USDC_CONTRACT=$NUSD_ID"
