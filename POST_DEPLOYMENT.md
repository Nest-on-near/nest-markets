# Post-Deployment Configuration (nest-markets)

After deploying `nest-markets` contracts, run these steps in order.

## Prerequisites

- `nest-contracts` oracle stack is already deployed and configured.
- The market collateral token is whitelisted in oracle (`whitelist_currency`) with final fee set.
- You have accounts for:
  - `owner` (market admin)
  - `market` contract account
  - `outcome-token` contract account
  - `usdc` token account (mock nUSD or production USDC)
  - test user accounts for smoke checks

---

## Step 1: Deploy Contracts

Deploy `outcome-token` and `market`:

```bash
# From nest-markets/contracts
(cd outcome-token && cargo near deploy build-non-reproducible-wasm <outcome-token-account>)
(cd market && cargo near deploy build-non-reproducible-wasm <market-account>)
```

If you need mock collateral for testnet testing, deploy `mock-ft` as nUSD:

```bash
(cd mock-ft && cargo near deploy build-non-reproducible-wasm <nusd-account>)
```

---

## Step 2: Initialize Contracts

Initialize outcome-token first, then market.

```bash
near contract call-function as-transaction <outcome-token-account> new json-args '{
  "market_contract": "<market-account>"
}' prepaid-gas '80 Tgas' attached-deposit '0 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send

near contract call-function as-transaction <market-account> new json-args '{
  "owner": "<owner-account>",
  "usdc_token": "<usdc-account>",
  "outcome_token": "<outcome-token-account>",
  "oracle": "<oracle-account>"
}' prepaid-gas '80 Tgas' attached-deposit '0 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send
```

If using `mock-ft`, initialize it too:

```bash
near contract call-function as-transaction <usdc-account> new json-args '{
  "owner": "<owner-account>",
  "total_supply": "0"
}' prepaid-gas '80 Tgas' attached-deposit '0 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send
```

---

## Step 3: Storage Registration (Required)

On the USDC token contract, register all accounts that will receive transfers:

- market contract (receives/sends collateral)
- oracle contract (receives resolution bond)
- users/LPs/resolvers/disputers
- **owner/treasury accounts that receive protocol fees during oracle settlement**

Why this matters:
- `ft_transfer` will fail with `The account <id> is not registered` if receiver storage is missing.
- During settlement, oracle may transfer to resolver/disputer **and** owner fee recipient. All must be registered.

```bash
near contract call-function as-transaction <usdc-account> storage_deposit json-args '{
  "account_id": "<market-account>",
  "registration_only": true
}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send

near contract call-function as-transaction <usdc-account> storage_deposit json-args '{
  "account_id": "<oracle-account>",
  "registration_only": true
}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send

near contract call-function as-transaction <usdc-account> storage_deposit json-args '{
  "account_id": "<owner-account>",
  "registration_only": true
}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send

near contract call-function as-transaction <usdc-account> storage_deposit json-args '{
  "account_id": "<treasury-account>",
  "registration_only": true
}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send

near contract call-function as-transaction <usdc-account> storage_deposit json-args '{
  "account_id": "<user-account>",
  "registration_only": true
}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as <user-account> network-config testnet sign-with-keychain send
```

Pre-check required before settlement/retry:

```bash
near contract call-function as-read-only <usdc-account> storage_balance_of json-args '{
  "account_id": "<owner-account>"
}' network-config testnet now
```

If this returns `null`, register that account with `storage_deposit` first.

---

## Step 4: Fund Test Users (if mock-ft)

```bash
near contract call-function as-transaction <usdc-account> mint json-args '{
  "account_id": "<user-account>",
  "amount": "5000000000"
}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <owner-account> network-config testnet sign-with-keychain send
```

`5000000000` with 6 decimals = `5000` nUSD.

---

## Step 5: Verify Core Wiring

```bash
near contract call-function as-read-only <market-account> get_config json-args '{}' network-config testnet now
```

Confirm:
- `owner == <owner-account>`
- `usdc_token == <usdc-account>`
- `outcome_token == <outcome-token-account>`
- `oracle == <oracle-account>`

Also verify user collateral balance:

```bash
near contract call-function as-read-only <usdc-account> ft_balance_of json-args '{
  "account_id": "<user-account>"
}' network-config testnet now
```

---

## Step 6: Smoke Test Market Flow

### 6.1 Create market (via USDC `ft_transfer_call`)

```bash
near contract call-function as-transaction <usdc-account> ft_transfer_call json-args '{
  "receiver_id": "<market-account>",
  "amount": "10000000",
  "msg": "{\"action\":\"CreateMarket\",\"question\":\"Will NEST ship v1?\",\"description\":\"Resolves YES if v1 ships by deadline\",\"resolution_time_ns\":\"1893456000000000000\"}"
}' prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' sign-as <user-account> network-config testnet sign-with-keychain send
```

`10000000` with 6 decimals = `10` nUSD initial liquidity.

### 6.2 Check market count and state

```bash
near contract call-function as-read-only <market-account> get_market_count json-args '{}' network-config testnet now
near contract call-function as-read-only <market-account> get_market json-args '{"market_id": 0}' network-config testnet now
near contract call-function as-read-only <market-account> get_prices json-args '{"market_id": 0}' network-config testnet now
```

### 6.3 Buy YES tokens

```bash
near contract call-function as-transaction <usdc-account> ft_transfer_call json-args '{
  "receiver_id": "<market-account>",
  "amount": "1000000",
  "msg": "{\"action\":\"Buy\",\"market_id\":0,\"outcome\":\"Yes\",\"min_tokens_out\":\"1\"}"
}' prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' sign-as <user-account> network-config testnet sign-with-keychain send
```

### 6.4 Verify outcome token balance

```bash
near contract call-function as-read-only <outcome-token-account> balance_of json-args '{
  "market_id": 0,
  "outcome": "Yes",
  "account_id": "<user-account>"
}' network-config testnet now
```

---

## Step 7: Resolution Path Readiness

Before calling `SubmitResolution`, ensure:

- market status is `Open` or `Closed`
- current timestamp is after `resolution_time_ns`
- resolver has USDC for bond
- oracle has this USDC token whitelisted with proper final fee

Submit resolution bond via USDC `ft_transfer_call`:

```bash
near contract call-function as-transaction <usdc-account> ft_transfer_call json-args '{
  "receiver_id": "<market-account>",
  "amount": "2000000",
  "msg": "{\"action\":\"SubmitResolution\",\"market_id\":0,\"outcome\":\"Yes\"}"
}' prepaid-gas '200 Tgas' attached-deposit '1 yoctoNEAR' sign-as <resolver-account> network-config testnet sign-with-keychain send
```

Then verify market state:

```bash
near contract call-function as-read-only <market-account> get_market json-args '{"market_id": 0}' network-config testnet now
```

---

## Step 8: Operational Safety Checks

- Keep `owner` as multisig/timelock account.
- Validate emergency methods are callable only by owner:
  - `set_owner`
  - `emergency_withdraw_token`
  - `emergency_withdraw_near`
- Confirm indexer/UI are configured with deployed IDs:
  - `apps/indexer/.env` (`MARKET_CONTRACT_ID`, etc.)
  - `apps/ui/src/config.ts` and runtime env vars.

---

## Quick Health Checklist

- [ ] `get_config` returns correct contract IDs
- [ ] USDC storage registration done for market + oracle + owner/treasury + active users
- [ ] User can create a market through `ft_transfer_call`
- [ ] User can buy and receive outcome balance
- [ ] Prices and reserves update through views
- [ ] Resolution submission transitions market to resolving path
