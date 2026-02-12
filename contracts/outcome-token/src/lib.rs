use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

use market_types::{MarketId, Outcome};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OutcomeToken {
    /// The market contract authorized to mint/burn
    market_contract: AccountId,

    /// Balances: compound key (market_id, outcome, account_id) -> balance
    balances: LookupMap<Vec<u8>, u128>,

    /// Total supply per (market_id, outcome)
    supply: LookupMap<Vec<u8>, u128>,
}

/// Build a storage key for a specific user balance
fn balance_key(market_id: MarketId, outcome: &Outcome, account_id: &AccountId) -> Vec<u8> {
    let mut key = Vec::with_capacity(8 + 1 + account_id.as_str().len());
    key.extend_from_slice(&market_id.to_le_bytes());
    key.push(outcome.as_bool() as u8);
    key.extend_from_slice(account_id.as_str().as_bytes());
    key
}

/// Build a storage key for total supply
fn supply_key(market_id: MarketId, outcome: &Outcome) -> Vec<u8> {
    let mut key = Vec::with_capacity(9);
    key.extend_from_slice(&market_id.to_le_bytes());
    key.push(outcome.as_bool() as u8);
    key
}

#[near]
impl OutcomeToken {
    #[init]
    pub fn new(market_contract: AccountId) -> Self {
        Self {
            market_contract,
            balances: LookupMap::new(b"b"),
            supply: LookupMap::new(b"s"),
        }
    }

    // ── Authorization ──────────────────────────────────────────────────

    fn assert_market_contract(&self) {
        require!(
            env::predecessor_account_id() == self.market_contract,
            "Only the market contract can call this method"
        );
    }

    // ── Authorized Methods ─────────────────────────────────────────────

    pub fn mint(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        account_id: AccountId,
        amount: U128,
    ) {
        self.assert_market_contract();
        let amount = amount.0;
        if amount == 0 {
            return;
        }

        // Update balance
        let bkey = balance_key(market_id, &outcome, &account_id);
        let balance = self.balances.get(&bkey).copied().unwrap_or(0);
        self.balances.insert(bkey, balance + amount);

        // Update supply
        let skey = supply_key(market_id, &outcome);
        let supply = self.supply.get(&skey).copied().unwrap_or(0);
        self.supply.insert(skey, supply + amount);
    }

    pub fn burn(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        account_id: AccountId,
        amount: U128,
    ) {
        self.assert_market_contract();
        let amount = amount.0;
        if amount == 0 {
            return;
        }

        // Update balance
        let bkey = balance_key(market_id, &outcome, &account_id);
        let balance = self.balances.get(&bkey).copied().unwrap_or(0);
        require!(balance >= amount, "Insufficient balance to burn");
        self.balances.insert(bkey, balance - amount);

        // Update supply
        let skey = supply_key(market_id, &outcome);
        let supply = self.supply.get(&skey).copied().unwrap_or(0);
        require!(supply >= amount, "Insufficient supply to burn");
        self.supply.insert(skey, supply - amount);
    }

    pub fn internal_transfer(
        &mut self,
        market_id: MarketId,
        outcome: Outcome,
        from: AccountId,
        to: AccountId,
        amount: U128,
    ) {
        self.assert_market_contract();
        let amount = amount.0;
        if amount == 0 {
            return;
        }

        let from_key = balance_key(market_id, &outcome, &from);
        let from_balance = self.balances.get(&from_key).copied().unwrap_or(0);
        require!(from_balance >= amount, "Insufficient balance to transfer");
        self.balances.insert(from_key, from_balance - amount);

        let to_key = balance_key(market_id, &outcome, &to);
        let to_balance = self.balances.get(&to_key).copied().unwrap_or(0);
        self.balances.insert(to_key, to_balance + amount);
    }

    // ── Views ──────────────────────────────────────────────────────────

    pub fn balance_of(
        &self,
        market_id: MarketId,
        outcome: Outcome,
        account_id: AccountId,
    ) -> U128 {
        let key = balance_key(market_id, &outcome, &account_id);
        U128(self.balances.get(&key).copied().unwrap_or(0))
    }

    pub fn total_supply(&self, market_id: MarketId, outcome: Outcome) -> U128 {
        let key = supply_key(market_id, &outcome);
        U128(self.supply.get(&key).copied().unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn market_account() -> AccountId {
        "market.testnet".parse().unwrap()
    }

    fn alice() -> AccountId {
        "alice.testnet".parse().unwrap()
    }

    fn bob() -> AccountId {
        "bob.testnet".parse().unwrap()
    }

    fn setup() -> OutcomeToken {
        let context = VMContextBuilder::new()
            .predecessor_account_id(market_account())
            .build();
        testing_env!(context);
        OutcomeToken::new(market_account())
    }

    #[test]
    fn test_mint_and_balance() {
        let mut contract = setup();
        contract.mint(0, Outcome::Yes, alice(), U128(1_000_000));
        assert_eq!(contract.balance_of(0, Outcome::Yes, alice()), U128(1_000_000));
        assert_eq!(contract.total_supply(0, Outcome::Yes), U128(1_000_000));
        assert_eq!(contract.balance_of(0, Outcome::No, alice()), U128(0));
    }

    #[test]
    fn test_burn() {
        let mut contract = setup();
        contract.mint(0, Outcome::Yes, alice(), U128(1_000_000));
        contract.burn(0, Outcome::Yes, alice(), U128(400_000));
        assert_eq!(contract.balance_of(0, Outcome::Yes, alice()), U128(600_000));
        assert_eq!(contract.total_supply(0, Outcome::Yes), U128(600_000));
    }

    #[test]
    #[should_panic(expected = "Insufficient balance to burn")]
    fn test_burn_insufficient() {
        let mut contract = setup();
        contract.mint(0, Outcome::Yes, alice(), U128(100));
        contract.burn(0, Outcome::Yes, alice(), U128(200));
    }

    #[test]
    fn test_internal_transfer() {
        let mut contract = setup();
        contract.mint(0, Outcome::No, alice(), U128(500));
        contract.internal_transfer(0, Outcome::No, alice(), bob(), U128(200));
        assert_eq!(contract.balance_of(0, Outcome::No, alice()), U128(300));
        assert_eq!(contract.balance_of(0, Outcome::No, bob()), U128(200));
    }

    #[test]
    #[should_panic(expected = "Only the market contract")]
    fn test_unauthorized_mint() {
        let mut contract = setup();
        let context = VMContextBuilder::new()
            .predecessor_account_id("hacker.testnet".parse().unwrap())
            .build();
        testing_env!(context);
        contract.mint(0, Outcome::Yes, alice(), U128(100));
    }

    #[test]
    fn test_different_markets_isolated() {
        let mut contract = setup();
        contract.mint(0, Outcome::Yes, alice(), U128(100));
        contract.mint(1, Outcome::Yes, alice(), U128(200));
        assert_eq!(contract.balance_of(0, Outcome::Yes, alice()), U128(100));
        assert_eq!(contract.balance_of(1, Outcome::Yes, alice()), U128(200));
    }
}
