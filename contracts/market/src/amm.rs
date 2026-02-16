use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseResult};

use market_types::*;

use crate::events::Event;
use crate::{MarketContract, MarketContractExt, GAS_FOR_MINT};

const GAS_FOR_SELL_BURN_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_REMOVE_LIQUIDITY_BURN_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);

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
                Promise::new(env::current_account_id())
                    .function_call(
                        "on_sell_burn_complete".to_string(),
                        near_sdk::serde_json::json!({
                            "seller": seller,
                            "amount": U128(collateral_out),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_SELL_BURN_CALLBACK,
                    )
            );
    }

    #[private]
    pub fn on_sell_burn_complete(&mut self, seller: AccountId, amount: U128) {
        require!(
            env::promise_results_count() == 1,
            "Expected one promise result"
        );

        match env::promise_result(0) {
            PromiseResult::Successful(_) => {
                Promise::new(self.usdc_token.clone()).function_call(
                    "ft_transfer".to_string(),
                    near_sdk::serde_json::json!({
                        "receiver_id": seller,
                        "amount": amount,
                    })
                    .to_string()
                    .into_bytes(),
                    NearToken::from_yoctonear(1),
                    GAS_FOR_FT_TRANSFER,
                );
            }
            _ => {
                env::panic_str("Token burn failed, cannot settle sell");
            }
        }
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
                Promise::new(env::current_account_id())
                    .function_call(
                        "on_remove_liquidity_burn_complete".to_string(),
                        near_sdk::serde_json::json!({
                            "provider": provider,
                            "amount": U128(collateral_out),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_REMOVE_LIQUIDITY_BURN_CALLBACK,
                    )
            );
    }

    #[private]
    pub fn on_remove_liquidity_burn_complete(&mut self, provider: AccountId, amount: U128) {
        require!(
            env::promise_results_count() == 2,
            "Expected two promise results"
        );
        let first_ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        let second_ok = matches!(env::promise_result(1), PromiseResult::Successful(_));

        if !first_ok || !second_ok {
            env::panic_str("Token burn failed, cannot remove liquidity");
        }

        Promise::new(self.usdc_token.clone()).function_call(
            "ft_transfer".to_string(),
            near_sdk::serde_json::json!({
                "receiver_id": provider,
                "amount": amount,
            })
            .to_string()
            .into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
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

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::store::LookupMap;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(id: &str) -> AccountId {
        id.parse().unwrap()
    }

    fn set_context_with_results(
        predecessor: &str,
        current: &str,
        promise_results: Vec<PromiseResult>,
    ) {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(account(predecessor))
            .current_account_id(account(current));

        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            promise_results
        );
    }

    fn test_contract() -> MarketContract {
        MarketContract {
            owner: account("owner.testnet"),
            usdc_token: account("usdc.testnet"),
            outcome_token: account("outcome.testnet"),
            oracle: account("oracle.testnet"),
            markets: LookupMap::new(b"m"),
            market_count: 0,
            lp_positions: LookupMap::new(b"l"),
            assertion_to_market: LookupMap::new(b"a"),
        }
    }

    fn base_market(id: u64, creator: &str) -> Market {
        Market {
            id,
            question: "Will test pass?".to_string(),
            description: "test".to_string(),
            creator: account(creator),
            resolution_time_ns: 999_999_999_999,
            status: MarketStatus::Open,
            outcome: None,
            yes_reserve: 50 * USDC_ONE,
            no_reserve: 50 * USDC_ONE,
            total_lp_shares: 100 * USDC_ONE,
            total_collateral: 100 * USDC_ONE,
            fee_bps: DEFAULT_FEE_BPS,
            accrued_fees: 0,
            assertion_id: None,
            asserted_outcome: None,
            resolver: None,
            disputer: None,
            assertion_submitted_at_ns: None,
            assertion_expires_at_ns: None,
        }
    }

    #[test]
    fn sell_updates_market_state_and_fees() {
        let mut contract = test_contract();
        contract.markets.insert(0, base_market(0, "creator.testnet"));
        set_context_with_results("seller.testnet", "market.testnet", vec![]);

        contract.sell(0, Outcome::Yes, U128(10 * USDC_ONE), U128(0));

        let market = contract.markets.get(&0).expect("market exists");
        assert!(market.total_collateral < 100 * USDC_ONE);
        assert!(market.accrued_fees > 0);
    }

    #[test]
    fn remove_liquidity_updates_market_and_lp_position() {
        let mut contract = test_contract();
        contract.markets.insert(0, base_market(0, "lp.testnet"));
        let key = MarketContract::lp_key(0, &account("lp.testnet"));
        contract.lp_positions.insert(key, 100 * USDC_ONE);
        set_context_with_results("lp.testnet", "market.testnet", vec![]);

        contract.remove_liquidity(0, U128(20 * USDC_ONE));

        let market = contract.markets.get(&0).expect("market exists");
        assert!(market.total_lp_shares < 100 * USDC_ONE);
        assert!(market.total_collateral < 100 * USDC_ONE);
    }

    #[test]
    fn on_sell_burn_complete_succeeds_on_successful_burn() {
        let mut contract = test_contract();
        set_context_with_results(
            "market.testnet",
            "market.testnet",
            vec![PromiseResult::Successful(vec![])],
        );

        contract.on_sell_burn_complete(account("seller.testnet"), U128(10 * USDC_ONE));
    }

    #[test]
    #[should_panic(expected = "Token burn failed, cannot settle sell")]
    fn on_sell_burn_complete_panics_on_failed_burn() {
        let mut contract = test_contract();
        set_context_with_results(
            "market.testnet",
            "market.testnet",
            vec![PromiseResult::Failed],
        );

        contract.on_sell_burn_complete(account("seller.testnet"), U128(10 * USDC_ONE));
    }

    #[test]
    fn on_remove_liquidity_burn_complete_succeeds_when_both_burns_succeed() {
        let mut contract = test_contract();
        set_context_with_results(
            "market.testnet",
            "market.testnet",
            vec![
                PromiseResult::Successful(vec![]),
                PromiseResult::Successful(vec![]),
            ],
        );

        contract.on_remove_liquidity_burn_complete(account("lp.testnet"), U128(5 * USDC_ONE));
    }

    #[test]
    #[should_panic(expected = "Token burn failed, cannot remove liquidity")]
    fn on_remove_liquidity_burn_complete_panics_if_any_burn_fails() {
        let mut contract = test_contract();
        set_context_with_results(
            "market.testnet",
            "market.testnet",
            vec![PromiseResult::Successful(vec![]), PromiseResult::Failed],
        );

        contract.on_remove_liquidity_burn_complete(account("lp.testnet"), U128(5 * USDC_ONE));
    }
}
