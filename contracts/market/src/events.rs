use near_sdk::json_types::{U128, U64};
use near_sdk::log;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::json;
use near_sdk::AccountId;

use market_types::{MarketId, Outcome};

const EVENT_STANDARD: &str = "nest-markets";
const EVENT_STANDARD_VERSION: &str = "1.0.0";

#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum Event<'a> {
    MarketCreated {
        market_id: MarketId,
        question: &'a str,
        resolution_time_ns: U64,
        creator: &'a AccountId,
        initial_liquidity: U128,
    },

    Trade {
        market_id: MarketId,
        trader: &'a AccountId,
        outcome: Outcome,
        is_buy: bool,
        collateral_amount: U128,
        token_amount: U128,
        yes_price: U128,
        no_price: U128,
    },

    LiquidityAdded {
        market_id: MarketId,
        provider: &'a AccountId,
        amount: U128,
        lp_shares: U128,
    },

    LiquidityRemoved {
        market_id: MarketId,
        provider: &'a AccountId,
        amount: U128,
        lp_shares: U128,
    },

    ResolutionSubmitted {
        market_id: MarketId,
        outcome: Outcome,
        resolver: &'a AccountId,
        assertion_id: &'a str,
    },

    MarketDisputed {
        market_id: MarketId,
        assertion_id: &'a str,
    },

    MarketSettled {
        market_id: MarketId,
        outcome: Outcome,
    },

    Redeemed {
        market_id: MarketId,
        user: &'a AccountId,
        collateral_out: U128,
    },
}

impl Event<'_> {
    pub fn emit(&self) {
        let data = json!(self);
        let event_json = json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_STANDARD_VERSION,
            "event": data["event"],
            "data": [data["data"]]
        });
        log!("EVENT_JSON:{}", event_json);
    }
}
