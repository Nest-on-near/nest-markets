use near_sdk::json_types::{U128, U64};
use near_sdk::near;

use market_types::*;

use crate::{MarketContract, MarketContractExt};

#[near]
impl MarketContract {
    pub fn get_market(&self, market_id: MarketId) -> Option<MarketView> {
        self.markets.get(&market_id).map(|m| m.to_view())
    }

    pub fn get_market_count(&self) -> u64 {
        self.market_count
    }

    pub fn get_prices(&self, market_id: MarketId) -> (U128, U128) {
        let market = self.markets.get(&market_id).expect("Market not found");
        let total = market.yes_reserve + market.no_reserve;
        if total == 0 {
            return (U128(AMM_SCALE / 2), U128(AMM_SCALE / 2));
        }
        (
            U128(market.no_reserve * AMM_SCALE / total),
            U128(market.yes_reserve * AMM_SCALE / total),
        )
    }

    pub fn estimate_buy(&self, market_id: MarketId, outcome: Outcome, collateral_in: U128) -> U128 {
        let market = self.markets.get(&market_id).expect("Market not found");
        let collateral_in = collateral_in.0;

        let fee = collateral_in * market.fee_bps as u128 / BPS_DENOMINATOR as u128;
        let net = collateral_in - fee;

        let yes_r = market.yes_reserve + net;
        let no_r = market.no_reserve + net;
        let k = yes_r * no_r;

        let tokens_out = match outcome {
            Outcome::Yes => {
                let final_no = no_r + net;
                let final_yes = k / final_no + 1;
                yes_r - final_yes
            }
            Outcome::No => {
                let final_yes = yes_r + net;
                let final_no = k / final_yes + 1;
                no_r - final_no
            }
        };

        U128(tokens_out)
    }

    pub fn get_lp_shares(&self, market_id: MarketId, account_id: near_sdk::AccountId) -> U128 {
        let key = Self::lp_key(market_id, &account_id);
        U128(self.lp_positions.get(&key).copied().unwrap_or(0))
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            usdc_token: self.usdc_token.clone(),
            outcome_token: self.outcome_token.clone(),
            oracle: self.oracle.clone(),
            market_count: U64(self.market_count),
            default_fee_bps: DEFAULT_FEE_BPS,
        }
    }

    pub fn get_resolution_status(&self, market_id: MarketId) -> ResolutionStatusView {
        let market = self.markets.get(&market_id).expect("Market not found");
        let now = near_sdk::env::block_timestamp();
        let is_resolvable_now = now >= market.resolution_time_ns
            && (market.status == MarketStatus::Open || market.status == MarketStatus::Closed);
        let is_disputable_now = market.status == MarketStatus::Resolving
            && market
                .assertion_expires_at_ns
                .map(|expiry| now < expiry)
                .unwrap_or(false);

        ResolutionStatusView {
            market_id: U64(market_id),
            status: market.status,
            active_assertion_id: market.assertion_id.map(hex::encode),
            asserted_outcome: market.asserted_outcome,
            resolver: market.resolver.clone(),
            disputer: market.disputer.clone(),
            assertion_submitted_at_ns: market.assertion_submitted_at_ns.map(U64),
            assertion_expires_at_ns: market.assertion_expires_at_ns.map(U64),
            now_ns: U64(now),
            is_disputable_now,
            is_resolvable_now,
        }
    }
}
