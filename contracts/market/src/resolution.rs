use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseResult};

use market_types::*;

use crate::events::Event;
use crate::{MarketContract, MarketContractExt};

const GAS_FOR_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_FOR_RESOLUTION_CALLBACK: Gas = Gas::from_tgas(15);
const DEFAULT_ORACLE_LIVENESS_NS: u64 = 2 * 60 * 60 * 1_000_000_000;
const DEFAULT_IDENTIFIER: Bytes32 = *b"ASSERT_TRUTH\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0";

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
        let now = env::block_timestamp();
        let market = self.markets.get(&market_id).expect("Market not found");
        require!(
            market.status == MarketStatus::Open || market.status == MarketStatus::Closed,
            "Market cannot be resolved in current status"
        );
        require!(
            now >= market.resolution_time_ns,
            "Resolution time has not passed yet"
        );

        let mut market = market.clone();
        let previous_status = market.status;
        market.status = MarketStatus::Resolving;
        market.asserted_outcome = Some(outcome);
        market.resolver = Some(resolver.clone());
        market.disputer = None;
        market.assertion_submitted_at_ns = Some(now);
        market.assertion_expires_at_ns = Some(now + DEFAULT_ORACLE_LIVENESS_NS);

        // Build claim: keccak256("market:{id}:outcome:{yes/no}")
        let outcome_str = match outcome {
            Outcome::Yes => "yes",
            Outcome::No => "no",
        };
        let claim_str = format!("market:{}:outcome:{}", market_id, outcome_str);
        let claim: Bytes32 = env::keccak256(claim_str.as_bytes())
            .try_into()
            .expect("keccak256 produces 32 bytes");

        if let Some(existing_assertion) = market.assertion_id {
            self.assertion_to_market.remove(&existing_assertion);
        }

        let assertion_id = Self::compute_assertion_id(
            claim,
            bond_amount,
            now,
            DEFAULT_ORACLE_LIVENESS_NS,
            &self.usdc_token,
            &Some(env::current_account_id()),
            &DEFAULT_IDENTIFIER,
            &env::current_account_id(),
        );
        let assertion_id_hex = hex::encode(assertion_id);
        market.assertion_id = Some(assertion_id);
        self.assertion_to_market.insert(assertion_id, market_id);

        self.markets.insert(market_id, market);

        // Forward bond to oracle via ft_transfer_call
        let oracle_msg = near_sdk::serde_json::json!({
            "action": "AssertTruth",
            "claim": claim,
            "asserter": resolver.to_string(),
            "callback_recipient": env::current_account_id().to_string(),
            "liveness_ns": U64(DEFAULT_ORACLE_LIVENESS_NS),
            "identifier": DEFAULT_IDENTIFIER,
            "assertion_time_ns": U64(now),
            "assertion_id_override": assertion_id,
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
                Promise::new(env::current_account_id()).function_call(
                    "on_resolution_submitted".to_string(),
                    near_sdk::serde_json::json!({
                        "market_id": market_id,
                        "outcome": outcome,
                        "resolver": resolver,
                        "assertion_id": assertion_id_hex,
                        "previous_status": previous_status,
                    })
                    .to_string()
                    .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_RESOLUTION_CALLBACK,
                ),
            );
    }

    // ── Resolution Submitted Callback ──────────────────────────────────

    #[private]
    pub fn on_resolution_submitted(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        resolver: AccountId,
        assertion_id: String,
        previous_status: MarketStatus,
    ) {
        let promise_succeeded = matches!(env::promise_result(0), PromiseResult::Successful(_));

        if !promise_succeeded {
            // ft_transfer_call to oracle failed — rollback market state
            let assertion_bytes: Bytes32 = hex::decode(&assertion_id)
                .expect("Invalid hex")
                .try_into()
                .expect("32 bytes");
            self.assertion_to_market.remove(&assertion_bytes);

            let market = self.markets.get(&market_id).expect("Market not found");
            let mut market = market.clone();
            market.status = previous_status;
            market.assertion_id = None;
            market.asserted_outcome = None;
            market.resolver = None;
            market.assertion_submitted_at_ns = None;
            market.assertion_expires_at_ns = None;
            self.markets.insert(market_id, market);

            env::log_str(&format!(
                "Resolution submission failed for market {market_id} — state rolled back"
            ));
            return;
        }

        Event::ResolutionSubmitted {
            market_id,
            outcome,
            resolver: &resolver,
            assertion_id: &assertion_id,
        }
        .emit();
    }

    // ── Oracle Callbacks ───────────────────────────────────────────────

    pub fn assertion_resolved_callback(&mut self, assertion_id: String, asserted_truthfully: bool) {
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
            market.assertion_id = None;
            market.asserted_outcome = None;
            market.assertion_submitted_at_ns = None;
            market.assertion_expires_at_ns = None;
            self.assertion_to_market.remove(&assertion_bytes);

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
            market.resolver = None;
            market.disputer = None;
            market.assertion_submitted_at_ns = None;
            market.assertion_expires_at_ns = None;
            self.assertion_to_market.remove(&assertion_bytes);
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
        market.disputer = None;
        self.markets.insert(market_id, market);

        Event::MarketDisputed {
            market_id,
            assertion_id: &assertion_id,
        }
        .emit();
    }

    fn compute_assertion_id(
        claim: Bytes32,
        bond: u128,
        time: u64,
        liveness: u64,
        currency: &AccountId,
        callback_recipient: &Option<AccountId>,
        identifier: &Bytes32,
        caller: &AccountId,
    ) -> Bytes32 {
        let mut data = Vec::new();
        data.extend_from_slice(&claim);
        data.extend_from_slice(&bond.to_le_bytes());
        data.extend_from_slice(&time.to_le_bytes());
        data.extend_from_slice(&liveness.to_le_bytes());
        data.extend_from_slice(currency.as_bytes());
        if let Some(cr) = callback_recipient {
            data.extend_from_slice(cr.as_bytes());
        }
        data.extend_from_slice(identifier);
        data.extend_from_slice(caller.as_bytes());

        env::keccak256(&data)
            .try_into()
            .expect("keccak256 should be 32 bytes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::store::LookupMap;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use near_sdk::AccountId;

    fn account(id: &str) -> AccountId {
        id.parse().unwrap()
    }

    fn context(predecessor: &str, current: &str, ts: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(account(predecessor))
            .current_account_id(account(current))
            .block_timestamp(ts);
        builder
    }

    fn base_market(id: u64, resolution_time_ns: u64, creator: &str) -> Market {
        Market {
            id,
            question: "Will test pass?".to_string(),
            description: "test".to_string(),
            creator: account(creator),
            resolution_time_ns,
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

    fn test_contract() -> MarketContract {
        MarketContract {
            owner: account("owner.testnet"),
            usdc_token: account("usdc.testnet"),
            outcome_token: account("outcome.testnet"),
            oracle: account("oracle.testnet"),
            markets: LookupMap::new(b"m"),
            market_count: 1,
            lp_positions: LookupMap::new(b"l"),
            assertion_to_market: LookupMap::new(b"a"),
        }
    }

    #[test]
    fn propose_then_undisputed_settle() {
        let mut contract = test_contract();
        contract
            .markets
            .insert(0, base_market(0, 100, "creator.testnet"));

        let submit_ts = 120;
        testing_env!(context("usdc.testnet", "market.testnet", submit_ts).build());
        contract.internal_submit_resolution(
            0,
            Outcome::Yes,
            10 * USDC_ONE,
            account("resolver.testnet"),
        );

        let resolving = contract.markets.get(&0).unwrap();
        assert_eq!(resolving.status, MarketStatus::Resolving);
        assert!(resolving.assertion_id.is_some());
        let assertion_id = resolving.assertion_id.unwrap();

        testing_env!(context("oracle.testnet", "market.testnet", 200).build());
        contract.assertion_resolved_callback(hex::encode(assertion_id), true);

        let settled = contract.markets.get(&0).unwrap();
        assert_eq!(settled.status, MarketStatus::Settled);
        assert_eq!(settled.outcome, Some(Outcome::Yes));
        assert!(settled.assertion_id.is_none());
    }

    #[test]
    fn propose_then_dispute_then_false_settle_reopens_market() {
        let mut contract = test_contract();
        contract
            .markets
            .insert(0, base_market(0, 100, "creator.testnet"));

        let submit_ts = 130;
        testing_env!(context("usdc.testnet", "market.testnet", submit_ts).build());
        contract.internal_submit_resolution(
            0,
            Outcome::No,
            10 * USDC_ONE,
            account("resolver.testnet"),
        );

        let assertion_id = contract
            .markets
            .get(&0)
            .and_then(|m| m.assertion_id)
            .expect("assertion id set");
        let assertion_hex = hex::encode(assertion_id);

        testing_env!(context("oracle.testnet", "market.testnet", 150).build());
        contract.assertion_disputed_callback(assertion_hex.clone());
        assert_eq!(
            contract.markets.get(&0).unwrap().status,
            MarketStatus::Disputed
        );

        testing_env!(context("oracle.testnet", "market.testnet", 170).build());
        contract.assertion_resolved_callback(assertion_hex, false);

        let reopened = contract.markets.get(&0).unwrap();
        assert_eq!(reopened.status, MarketStatus::Closed);
        assert!(reopened.assertion_id.is_none());
        assert!(reopened.asserted_outcome.is_none());
    }

    #[test]
    #[should_panic(expected = "Only oracle can call this callback")]
    fn callback_rejected_for_non_oracle_caller() {
        let mut contract = test_contract();
        testing_env!(context("attacker.testnet", "market.testnet", 999).build());
        contract.assertion_disputed_callback("00".repeat(32));
    }
}
