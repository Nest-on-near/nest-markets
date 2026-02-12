use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

use market_types::*;

use crate::events::Event;
use crate::{MarketContract, MarketContractExt};

const GAS_FOR_BURN: Gas = Gas::from_tgas(10);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_REDEEM_CALLBACK: Gas = Gas::from_tgas(10);

#[near]
impl MarketContract {
    /// Redeem winning outcome tokens for USDC 1:1 after market settlement.
    pub fn redeem_tokens(&mut self, market_id: MarketId, amount: U128) {
        let redeemer = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "Amount must be greater than 0");

        let market = self.markets.get(&market_id).expect("Market not found");
        require!(
            market.status == MarketStatus::Settled,
            "Market is not settled"
        );
        let winning_outcome = market.outcome.expect("Settled market must have outcome");

        // Burn winning tokens from redeemer, then transfer USDC
        Promise::new(self.outcome_token.clone())
            .function_call(
                "burn".to_string(),
                near_sdk::serde_json::json!({
                    "market_id": market_id,
                    "outcome": winning_outcome,
                    "account_id": redeemer.clone(),
                    "amount": U128(amount),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_BURN,
            )
            .then(
                Promise::new(env::current_account_id())
                    .function_call(
                        "on_redeem_burn_complete".to_string(),
                        near_sdk::serde_json::json!({
                            "market_id": market_id,
                            "redeemer": redeemer,
                            "amount": U128(amount),
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_REDEEM_CALLBACK,
                    )
            );
    }

    #[private]
    pub fn on_redeem_burn_complete(
        &mut self,
        market_id: MarketId,
        redeemer: AccountId,
        amount: U128,
    ) {
        // Check the burn succeeded (predecessor is self due to #[private])
        require!(
            env::promise_results_count() == 1,
            "Expected one promise result"
        );

        match env::promise_result(0) {
            near_sdk::PromiseResult::Successful(_) => {
                // Burn succeeded, transfer USDC to redeemer
                Event::Redeemed {
                    market_id,
                    user: &redeemer,
                    collateral_out: amount,
                }
                .emit();

                Promise::new(self.usdc_token.clone())
                    .function_call(
                        "ft_transfer".to_string(),
                        near_sdk::serde_json::json!({
                            "receiver_id": redeemer,
                            "amount": amount,
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(1),
                        GAS_FOR_FT_TRANSFER,
                    );
            }
            _ => {
                env::panic_str("Token burn failed, cannot redeem");
            }
        }
    }
}
