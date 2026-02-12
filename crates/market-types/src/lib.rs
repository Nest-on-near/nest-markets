use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;

// ── Constants ──────────────────────────────────────────────────────────

pub type MarketId = u64;
pub type Bytes32 = [u8; 32];

/// USDC has 6 decimals
pub const USDC_DECIMALS: u8 = 6;
pub const USDC_ONE: u128 = 1_000_000;

/// Minimum initial liquidity: 10 USDC
pub const MIN_INITIAL_LIQUIDITY: u128 = 10 * USDC_ONE;

/// AMM price scale (1e6, matching USDC decimals for precision)
pub const AMM_SCALE: u128 = 1_000_000;

/// Default protocol fee: 2% = 200 basis points
pub const DEFAULT_FEE_BPS: u16 = 200;
pub const BPS_DENOMINATOR: u16 = 10_000;

// ── Enums ──────────────────────────────────────────────────────────────

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum Outcome {
    Yes,
    No,
}

impl Outcome {
    pub fn as_bool(&self) -> bool {
        match self {
            Outcome::Yes => true,
            Outcome::No => false,
        }
    }

    pub fn from_bool(val: bool) -> Self {
        if val { Outcome::Yes } else { Outcome::No }
    }

    pub fn opposite(&self) -> Self {
        match self {
            Outcome::Yes => Outcome::No,
            Outcome::No => Outcome::Yes,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum MarketStatus {
    Open,
    Closed,
    Resolving,
    Disputed,
    Settled,
}

// ── Market Struct ──────────────────────────────────────────────────────

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
pub struct Market {
    pub id: MarketId,
    pub question: String,
    pub description: String,
    pub creator: AccountId,
    pub resolution_time_ns: u64,
    pub status: MarketStatus,
    pub outcome: Option<Outcome>,

    // AMM reserves
    pub yes_reserve: u128,
    pub no_reserve: u128,

    // Liquidity
    pub total_lp_shares: u128,

    // Collateral
    pub total_collateral: u128,

    // Fees
    pub fee_bps: u16,
    pub accrued_fees: u128,

    // Oracle
    pub assertion_id: Option<Bytes32>,
    pub asserted_outcome: Option<Outcome>,
}

// ── View Types ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct MarketView {
    pub id: U64,
    pub question: String,
    pub description: String,
    pub creator: AccountId,
    pub resolution_time_ns: U64,
    pub status: MarketStatus,
    pub outcome: Option<Outcome>,
    pub yes_reserve: U128,
    pub no_reserve: U128,
    pub yes_price: U128,
    pub no_price: U128,
    pub total_lp_shares: U128,
    pub total_collateral: U128,
    pub fee_bps: u16,
    pub accrued_fees: U128,
}

impl Market {
    pub fn to_view(&self) -> MarketView {
        let (yes_price, no_price) = if self.yes_reserve > 0 && self.no_reserve > 0 {
            let total = self.yes_reserve + self.no_reserve;
            (
                self.no_reserve * AMM_SCALE / total,
                self.yes_reserve * AMM_SCALE / total,
            )
        } else {
            (AMM_SCALE / 2, AMM_SCALE / 2)
        };

        MarketView {
            id: U64(self.id),
            question: self.question.clone(),
            description: self.description.clone(),
            creator: self.creator.clone(),
            resolution_time_ns: U64(self.resolution_time_ns),
            status: self.status,
            outcome: self.outcome,
            yes_reserve: U128(self.yes_reserve),
            no_reserve: U128(self.no_reserve),
            yes_price: U128(yes_price),
            no_price: U128(no_price),
            total_lp_shares: U128(self.total_lp_shares),
            total_collateral: U128(self.total_collateral),
            fee_bps: self.fee_bps,
            accrued_fees: U128(self.accrued_fees),
        }
    }
}

// ── FT Message Enums ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "action")]
pub enum MarketFtMsg {
    CreateMarket {
        question: String,
        description: String,
        resolution_time_ns: U64,
    },
    Buy {
        market_id: MarketId,
        outcome: Outcome,
        min_tokens_out: U128,
    },
    AddLiquidity {
        market_id: MarketId,
    },
    SubmitResolution {
        market_id: MarketId,
        outcome: Outcome,
    },
}

// ── Config View ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ConfigView {
    pub owner: AccountId,
    pub usdc_token: AccountId,
    pub outcome_token: AccountId,
    pub oracle: AccountId,
    pub market_count: U64,
    pub default_fee_bps: u16,
}
