use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

use market_types::*;

use crate::events::Event;
use crate::{MarketContract, MarketContractExt, GAS_FOR_MINT};

#[near]
impl MarketContract {
    // ── Buy Flow ───────────────────────────────────────────────────────
    // 1. Deduct fee from collateral
    // 2. Mint equal YES+NO to contract (added to reserves)
    // 3. Swap unwanted side: sell opposite tokens into pool, receive desired tokens
    // 4. Mint desired tokens to buyer via outcome-token contract

    pub(crate) fn internal_buy(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        collateral: u128,
        min_tokens_out: u128,
        buyer: AccountId,
    ) {
        let market = self.markets.get(&market_id).expect("Market not found");
        require!(market.status == MarketStatus::Open, "Market is not open for trading");

        // Deduct fee
        let fee = collateral * market.fee_bps as u128 / BPS_DENOMINATOR as u128;
        let net_collateral = collateral - fee;

        let mut market = market.clone();
        market.accrued_fees += fee;
        market.total_collateral += net_collateral;

        // Mint-and-swap: add net_collateral to both reserves, then swap
        let yes_r = market.yes_reserve + net_collateral;
        let no_r = market.no_reserve + net_collateral;
        // k = yes_r * no_r (safe for USDC amounts up to ~18B USDC per side)
        let k = yes_r * no_r;

        let tokens_out = match outcome {
            Outcome::Yes => {
                // User wants YES. NO side gets the minted NO tokens.
                let final_no = no_r + net_collateral; // NO reserve absorbs minted NO
                let final_yes = k / final_no + 1; // round up to protect pool
                let yes_out = yes_r - final_yes;
                market.yes_reserve = final_yes;
                market.no_reserve = final_no;
                yes_out
            }
            Outcome::No => {
                let final_yes = yes_r + net_collateral;
                let final_no = k / final_yes + 1;
                let no_out = no_r - final_no;
                market.yes_reserve = final_yes;
                market.no_reserve = final_no;
                no_out
            }
        };

        require!(
            tokens_out >= min_tokens_out,
            format!("Slippage: would receive {} but minimum is {}", tokens_out, min_tokens_out)
        );

        // Emit trade event
        let total = market.yes_reserve + market.no_reserve;
        Event::Trade {
            market_id,
            trader: &buyer,
            outcome,
            is_buy: true,
            collateral_amount: U128(collateral),
            token_amount: U128(tokens_out),
            yes_price: U128(market.no_reserve * AMM_SCALE / total),
            no_price: U128(market.yes_reserve * AMM_SCALE / total),
        }
        .emit();

        self.markets.insert(market_id, market);

        // Mint tokens to buyer via cross-contract call
        Promise::new(self.outcome_token.clone())
            .function_call(
                "mint".to_string(),
                near_sdk::serde_json::json!({
                    "market_id": market_id,
                    "outcome": outcome,
                    "account_id": buyer,
                    "amount": U128(tokens_out),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MINT,
            );
    }

    // ── Sell Flow ──────────────────────────────────────────────────────
    // 1. Caller's tokens added to pool reserves
    // 2. Extract equivalent opposite tokens from pool (AMM swap)
    // 3. Burn matched pairs to release USDC
    // 4. Deduct fee, transfer USDC to seller

    pub fn sell(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        tokens_in: U128,
        min_collateral_out: U128,
    ) {
        let seller = env::predecessor_account_id();
        let tokens_in = tokens_in.0;
        let min_collateral_out = min_collateral_out.0;

        let market = self.markets.get(&market_id).expect("Market not found");
        require!(market.status == MarketStatus::Open, "Market is not open for trading");
        let mut market = market.clone();

        // Swap: add tokens_in to the outcome's reserve, extract from opposite
        let (collateral_before_fee, new_yes, new_no) = match outcome {
            Outcome::Yes => {
                let k = market.yes_reserve * market.no_reserve;
                let new_yes = market.yes_reserve + tokens_in;
                let new_no = k / new_yes + 1;
                let no_extracted = market.no_reserve - new_no;
                // Burn matched pairs: min(tokens_in, no_extracted) pairs
                let pairs = tokens_in.min(no_extracted);
                (pairs, new_yes - pairs, new_no)
            }
            Outcome::No => {
                let k = market.yes_reserve * market.no_reserve;
                let new_no = market.no_reserve + tokens_in;
                let new_yes = k / new_no + 1;
                let yes_extracted = market.yes_reserve - new_yes;
                let pairs = tokens_in.min(yes_extracted);
                (pairs, new_yes, new_no - pairs)
            }
        };

        let fee = collateral_before_fee * market.fee_bps as u128 / BPS_DENOMINATOR as u128;
        let collateral_out = collateral_before_fee - fee;

        require!(
            collateral_out >= min_collateral_out,
            format!("Slippage: would receive {} but minimum is {}", collateral_out, min_collateral_out)
        );

        market.yes_reserve = new_yes;
        market.no_reserve = new_no;
        market.accrued_fees += fee;
        market.total_collateral -= collateral_before_fee;

        let total = market.yes_reserve + market.no_reserve;
        Event::Trade {
            market_id,
            trader: &seller,
            outcome,
            is_buy: false,
            collateral_amount: U128(collateral_out),
            token_amount: U128(tokens_in),
            yes_price: U128(if total > 0 { market.no_reserve * AMM_SCALE / total } else { AMM_SCALE / 2 }),
            no_price: U128(if total > 0 { market.yes_reserve * AMM_SCALE / total } else { AMM_SCALE / 2 }),
        }
        .emit();

        self.markets.insert(market_id, market);

        // Burn seller's tokens via cross-contract call, then transfer USDC
        Promise::new(self.outcome_token.clone())
            .function_call(
                "burn".to_string(),
                near_sdk::serde_json::json!({
                    "market_id": market_id,
                    "outcome": outcome,
                    "account_id": seller.clone(),
                    "amount": U128(tokens_in),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MINT,
            )
            .then(
                Promise::new(self.usdc_token.clone())
                    .function_call(
                        "ft_transfer".to_string(),
                        near_sdk::serde_json::json!({
                            "receiver_id": seller,
                            "amount": U128(collateral_out),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(1),
                        Gas::from_tgas(10),
                    )
            );
    }

    // ── Add Liquidity ──────────────────────────────────────────────────

    pub(crate) fn internal_add_liquidity(
        &mut self,
        market_id: MarketId,
        amount: u128,
        provider: AccountId,
    ) {
        let market = self.markets.get(&market_id).expect("Market not found");
        require!(market.status == MarketStatus::Open, "Market is not open");
        let mut market = market.clone();

        // Calculate LP shares proportional to existing reserves
        let lp_shares = if market.total_lp_shares == 0 {
            amount
        } else {
            amount * market.total_lp_shares / market.total_collateral
        };

        require!(lp_shares > 0, "Liquidity too small");

        // Add to both reserves proportionally
        let yes_add = amount * market.yes_reserve / market.total_collateral;
        let no_add = amount * market.no_reserve / market.total_collateral;
        market.yes_reserve += yes_add;
        market.no_reserve += no_add;
        market.total_collateral += amount;
        market.total_lp_shares += lp_shares;

        // Track LP position
        let lp_key = Self::lp_key(market_id, &provider);
        let existing = self.lp_positions.get(&lp_key).copied().unwrap_or(0);
        self.lp_positions.insert(lp_key, existing + lp_shares);

        Event::LiquidityAdded {
            market_id,
            provider: &provider,
            amount: U128(amount),
            lp_shares: U128(lp_shares),
        }
        .emit();

        self.markets.insert(market_id, market);

        // Mint YES+NO tokens to contract to back reserves
        let contract_id = env::current_account_id();
        Promise::new(self.outcome_token.clone())
            .function_call(
                "mint".to_string(),
                near_sdk::serde_json::json!({
                    "market_id": market_id,
                    "outcome": Outcome::Yes,
                    "account_id": contract_id,
                    "amount": U128(yes_add),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MINT,
            )
            .and(
                Promise::new(self.outcome_token.clone())
                    .function_call(
                        "mint".to_string(),
                        near_sdk::serde_json::json!({
                            "market_id": market_id,
                            "outcome": Outcome::No,
                            "account_id": contract_id,
                            "amount": U128(no_add),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_MINT,
                    )
            );
    }

    // ── Remove Liquidity ───────────────────────────────────────────────

    pub fn remove_liquidity(&mut self, market_id: MarketId, shares: U128) {
        let provider = env::predecessor_account_id();
        let shares = shares.0;

        let lp_key = Self::lp_key(market_id, &provider);
        let lp_balance = self.lp_positions.get(&lp_key).copied().unwrap_or(0);
        require!(lp_balance >= shares, "Insufficient LP shares");

        let market = self.markets.get(&market_id).expect("Market not found");
        require!(market.status == MarketStatus::Open, "Market is not open");
        let mut market = market.clone();

        // Calculate proportional withdrawal
        let collateral_out = shares * market.total_collateral / market.total_lp_shares;
        let yes_remove = shares * market.yes_reserve / market.total_lp_shares;
        let no_remove = shares * market.no_reserve / market.total_lp_shares;

        market.yes_reserve -= yes_remove;
        market.no_reserve -= no_remove;
        market.total_collateral -= collateral_out;
        market.total_lp_shares -= shares;

        self.lp_positions.insert(lp_key, lp_balance - shares);

        Event::LiquidityRemoved {
            market_id,
            provider: &provider,
            amount: U128(collateral_out),
            lp_shares: U128(shares),
        }
        .emit();

        self.markets.insert(market_id, market);

        // Burn contract's tokens and transfer USDC to provider
        let contract_id = env::current_account_id();
        Promise::new(self.outcome_token.clone())
            .function_call(
                "burn".to_string(),
                near_sdk::serde_json::json!({
                    "market_id": market_id,
                    "outcome": Outcome::Yes,
                    "account_id": contract_id,
                    "amount": U128(yes_remove),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MINT,
            )
            .and(
                Promise::new(self.outcome_token.clone())
                    .function_call(
                        "burn".to_string(),
                        near_sdk::serde_json::json!({
                            "market_id": market_id,
                            "outcome": Outcome::No,
                            "account_id": contract_id,
                            "amount": U128(no_remove),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_MINT,
                    )
            )
            .then(
                Promise::new(self.usdc_token.clone())
                    .function_call(
                        "ft_transfer".to_string(),
                        near_sdk::serde_json::json!({
                            "receiver_id": provider,
                            "amount": U128(collateral_out),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(1),
                        Gas::from_tgas(10),
                    )
            );
    }

    // ── Helpers ────────────────────────────────────────────────────────

    pub(crate) fn lp_key(market_id: MarketId, account: &AccountId) -> Vec<u8> {
        let mut key = Vec::new();
        key.extend_from_slice(&market_id.to_le_bytes());
        key.extend_from_slice(account.as_str().as_bytes());
        key
    }
}
