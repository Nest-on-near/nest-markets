use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

use market_types::*;

use crate::events::Event;
use crate::{MarketContract, MarketContractExt};

const GAS_FOR_FT_TRANSFER_CALL: Gas = Gas::from_tgas(30);

#[near]
impl MarketContract {
    // ── Submit Resolution ──────────────────────────────────────────────
    // Called via ft_transfer_call with SubmitResolution message.
    // The attached USDC is the oracle bond.

    pub(crate) fn internal_submit_resolution(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        bond_amount: u128,
        resolver: AccountId,
    ) {
        let market = self.markets.get(&market_id).expect("Market not found");
        require!(
            market.status == MarketStatus::Open || market.status == MarketStatus::Closed,
            "Market cannot be resolved in current status"
        );
        require!(
            env::block_timestamp() >= market.resolution_time_ns,
            "Resolution time has not passed yet"
        );

        let mut market = market.clone();
        market.status = MarketStatus::Resolving;
        market.asserted_outcome = Some(outcome);

        // Build claim: keccak256("market:{id}:outcome:{yes/no}")
        let outcome_str = match outcome {
            Outcome::Yes => "yes",
            Outcome::No => "no",
        };
        let claim_str = format!("market:{}:outcome:{}", market_id, outcome_str);
        let claim: Bytes32 = env::keccak256(claim_str.as_bytes())
            .try_into()
            .expect("keccak256 produces 32 bytes");

        let claim_hex = hex::encode(claim);

        self.markets.insert(market_id, market);

        // Store resolver for this market (for event emission after callback)
        // Forward bond to oracle via ft_transfer_call
        let oracle_msg = near_sdk::serde_json::json!({
            "action": "AssertTruth",
            "claim": claim_hex,
            "asserter": resolver.to_string(),
            "callback_recipient": env::current_account_id().to_string(),
        });

        Promise::new(self.usdc_token.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                near_sdk::serde_json::json!({
                    "receiver_id": self.oracle.to_string(),
                    "amount": U128(bond_amount),
                    "msg": oracle_msg.to_string(),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FOR_FT_TRANSFER_CALL,
            )
            .then(
                Promise::new(env::current_account_id())
                    .function_call(
                        "on_resolution_submitted".to_string(),
                        near_sdk::serde_json::json!({
                            "market_id": market_id,
                            "outcome": outcome,
                            "resolver": resolver,
                            "claim_hex": claim_hex,
                        })
                        .to_string()
                        .into_bytes(),
                        NearToken::from_yoctonear(0),
                        Gas::from_tgas(10),
                    )
            );
    }

    // ── Resolution Submitted Callback ──────────────────────────────────

    #[private]
    pub fn on_resolution_submitted(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        resolver: AccountId,
        claim_hex: String,
    ) {
        // In production, we'd extract the assertion_id from the oracle's return value.
        // For now, use the claim_hex as a reference.
        Event::ResolutionSubmitted {
            market_id,
            outcome,
            resolver: &resolver,
            assertion_id: &claim_hex,
        }
        .emit();
    }

    // ── Oracle Callbacks ───────────────────────────────────────────────

    pub fn assertion_resolved_callback(
        &mut self,
        assertion_id: String,
        asserted_truthfully: bool,
    ) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "Only oracle can call this callback"
        );

        let assertion_bytes: Bytes32 = hex::decode(&assertion_id)
            .expect("Invalid assertion_id hex")
            .try_into()
            .expect("assertion_id must be 32 bytes");

        let market_id = self
            .assertion_to_market
            .get(&assertion_bytes)
            .copied()
            .expect("No market found for this assertion");

        let market = self.markets.get(&market_id).expect("Market not found");
        let mut market = market.clone();

        if asserted_truthfully {
            // Asserter was correct — settle with asserted outcome
            market.outcome = market.asserted_outcome;
            market.status = MarketStatus::Settled;

            Event::MarketSettled {
                market_id,
                outcome: market.outcome.unwrap(),
            }
            .emit();
        } else {
            // Disputer won — revert to Closed for re-resolution
            market.status = MarketStatus::Closed;
            market.asserted_outcome = None;
            market.assertion_id = None;
        }

        self.markets.insert(market_id, market);
    }

    pub fn assertion_disputed_callback(&mut self, assertion_id: String) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "Only oracle can call this callback"
        );

        let assertion_bytes: Bytes32 = hex::decode(&assertion_id)
            .expect("Invalid assertion_id hex")
            .try_into()
            .expect("assertion_id must be 32 bytes");

        let market_id = self
            .assertion_to_market
            .get(&assertion_bytes)
            .copied()
            .expect("No market found for this assertion");

        let market = self.markets.get(&market_id).expect("Market not found");
        let mut market = market.clone();
        market.status = MarketStatus::Disputed;
        self.markets.insert(market_id, market);

        Event::MarketDisputed {
            market_id,
            assertion_id: &assertion_id,
        }
        .emit();
    }
}
