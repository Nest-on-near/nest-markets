mod amm;
mod events;
mod redemption;
mod resolution;
mod views;

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

use market_types::*;

use events::Event;

pub const GAS_FOR_MINT: Gas = Gas::from_tgas(10);
pub const GAS_FOR_MINT_CALLBACK: Gas = Gas::from_tgas(5);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MarketContract {
    /// Contract owner
    owner: AccountId,

    /// USDC token contract
    usdc_token: AccountId,

    /// Outcome token contract
    outcome_token: AccountId,

    /// Nest Optimistic Oracle contract
    oracle: AccountId,

    /// All markets
    markets: LookupMap<MarketId, Market>,

    /// Market counter
    market_count: u64,

    /// LP positions: compound key (market_id + account) -> shares
    lp_positions: LookupMap<Vec<u8>, u128>,

    /// Mapping from oracle assertion_id to market_id
    assertion_to_market: LookupMap<Bytes32, MarketId>,
}

#[near]
impl MarketContract {
    #[init]
    pub fn new(
        owner: AccountId,
        usdc_token: AccountId,
        outcome_token: AccountId,
        oracle: AccountId,
    ) -> Self {
        Self {
            owner,
            usdc_token,
            outcome_token,
            oracle,
            markets: LookupMap::new(b"m"),
            market_count: 0,
            lp_positions: LookupMap::new(b"l"),
            assertion_to_market: LookupMap::new(b"a"),
        }
    }

    // ── Admin / Emergency Controls ─────────────────────────────────────

    /// Transfer contract ownership.
    pub fn set_owner(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.owner = new_owner;
    }

    /// Emergency token withdrawal for stuck funds recovery.
    /// Owner-only: this can move core funds and should only be used operationally.
    pub fn emergency_withdraw_token(
        &mut self,
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> Promise {
        self.assert_owner();
        require!(amount.0 > 0, "Amount must be positive");

        Promise::new(token).function_call(
            "ft_transfer".to_string(),
            near_sdk::serde_json::json!({
                "receiver_id": receiver_id,
                "amount": amount,
            })
            .to_string()
            .into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(10),
        )
    }

    /// Emergency native NEAR withdrawal for stuck balance recovery.
    /// Owner-only.
    pub fn emergency_withdraw_near(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 > 0, "Amount must be positive");
        require!(
            env::account_balance() >= NearToken::from_yoctonear(amount.0),
            "Insufficient balance"
        );

        Promise::new(receiver_id).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ── ft_on_transfer Router ──────────────────────────────────────────

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let token = env::predecessor_account_id();
        require!(token == self.usdc_token, "Only USDC is accepted");

        let parsed: MarketFtMsg =
            near_sdk::serde_json::from_str(&msg).expect("Invalid ft_on_transfer message");

        match parsed {
            MarketFtMsg::CreateMarket {
                question,
                description,
                resolution_time_ns,
            } => {
                self.internal_create_market(
                    question,
                    description,
                    resolution_time_ns.0,
                    amount.0,
                    sender_id,
                );
                U128(0) // all tokens used
            }
            MarketFtMsg::Buy {
                market_id,
                outcome,
                min_tokens_out,
            } => {
                self.internal_buy(market_id, outcome, amount.0, min_tokens_out.0, sender_id);
                U128(0)
            }
            MarketFtMsg::AddLiquidity { market_id } => {
                self.internal_add_liquidity(market_id, amount.0, sender_id);
                U128(0)
            }
            MarketFtMsg::SubmitResolution { market_id, outcome } => {
                self.internal_submit_resolution(market_id, outcome, amount.0, sender_id);
                U128(0)
            }
        }
    }

    // ── Create Market ──────────────────────────────────────────────────

    fn internal_create_market(
        &mut self,
        question: String,
        description: String,
        resolution_time_ns: u64,
        initial_liquidity: u128,
        creator: AccountId,
    ) {
        require!(
            initial_liquidity >= MIN_INITIAL_LIQUIDITY,
            format!(
                "Minimum initial liquidity is {} USDC",
                MIN_INITIAL_LIQUIDITY / USDC_ONE
            )
        );
        require!(
            resolution_time_ns > env::block_timestamp(),
            "Resolution time must be in the future"
        );
        require!(!question.is_empty(), "Question cannot be empty");

        let market_id = self.market_count;
        self.market_count += 1;

        // Initialize with 50/50 reserves
        let half = initial_liquidity / 2;
        let market = Market {
            id: market_id,
            question: question.clone(),
            description,
            creator: creator.clone(),
            resolution_time_ns,
            status: MarketStatus::Open,
            outcome: None,
            yes_reserve: half,
            no_reserve: half,
            total_lp_shares: initial_liquidity,
            total_collateral: initial_liquidity,
            fee_bps: DEFAULT_FEE_BPS,
            accrued_fees: 0,
            assertion_id: None,
            asserted_outcome: None,
            resolver: None,
            disputer: None,
            assertion_submitted_at_ns: None,
            assertion_expires_at_ns: None,
        };

        // Record LP position for creator
        let lp_key = Self::lp_key(market_id, &creator);
        self.lp_positions.insert(lp_key, initial_liquidity);

        Event::MarketCreated {
            market_id,
            question: &question,
            resolution_time_ns: near_sdk::json_types::U64(resolution_time_ns),
            creator: &creator,
            initial_liquidity: U128(initial_liquidity),
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
                    "amount": U128(half),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_MINT,
            )
            .and(
                Promise::new(self.outcome_token.clone()).function_call(
                    "mint".to_string(),
                    near_sdk::serde_json::json!({
                        "market_id": market_id,
                        "outcome": Outcome::No,
                        "account_id": contract_id,
                        "amount": U128(half),
                    })
                    .to_string()
                    .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_MINT,
                ),
            );
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only owner can call this method"
        );
    }
}
