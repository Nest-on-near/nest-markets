use serde_json::json;

const MOCK_FT_WASM: &str = "../target/near/mock_ft/mock_ft.wasm";
const OUTCOME_TOKEN_WASM: &str = "../target/near/outcome_token/outcome_token.wasm";
const MARKET_WASM: &str = "../target/near/market_contract/market_contract.wasm";

const USDC_ONE: u128 = 1_000_000; // 6 decimals

async fn read_wasm(path: &str) -> Vec<u8> {
    let abs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    tokio::fs::read(&abs).await.unwrap_or_else(|_| {
        panic!(
            "WASM not found at: {}\nRun: cargo build --release --target wasm32-unknown-unknown -p mock-ft -p outcome-token -p market-contract",
            abs.display()
        )
    })
}

async fn storage_deposit(
    caller: &near_workspaces::Account,
    token: &near_workspaces::Contract,
) -> anyhow::Result<()> {
    caller
        .call(token.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(near_workspaces::types::NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn ft_balance(
    token: &near_workspaces::Contract,
    account_id: &near_workspaces::AccountId,
) -> anyhow::Result<u128> {
    let balance: String = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": account_id }))
        .await?
        .json()?;
    Ok(balance.parse().unwrap())
}

async fn ft_transfer_call(
    sender: &near_workspaces::Account,
    token: &near_workspaces::Contract,
    receiver: &near_workspaces::Contract,
    amount: u128,
    msg: &serde_json::Value,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let result = sender
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": receiver.id(),
            "amount": amount.to_string(),
            "msg": msg.to_string(),
        }))
        .deposit(near_workspaces::types::NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await?;
    Ok(result)
}

async fn outcome_balance(
    outcome_token: &near_workspaces::Contract,
    market_id: u64,
    outcome: &str,
    account_id: &near_workspaces::AccountId,
) -> anyhow::Result<u128> {
    let balance: String = outcome_token
        .view("balance_of")
        .args_json(json!({
            "market_id": market_id,
            "outcome": outcome,
            "account_id": account_id,
        }))
        .await?
        .json()?;
    Ok(balance.parse().unwrap())
}

/// Deploys and initializes all three contracts + creates test accounts with USDC.
struct TestSetup {
    usdc: near_workspaces::Contract,
    outcome_token: near_workspaces::Contract,
    market: near_workspaces::Contract,
    owner: near_workspaces::Account,
    alice: near_workspaces::Account,
    bob: near_workspaces::Account,
}

async fn setup() -> anyhow::Result<TestSetup> {
    let sandbox = near_workspaces::sandbox().await?;

    let usdc = sandbox.dev_deploy(&read_wasm(MOCK_FT_WASM).await).await?;
    let outcome_token = sandbox.dev_deploy(&read_wasm(OUTCOME_TOKEN_WASM).await).await?;
    let market = sandbox.dev_deploy(&read_wasm(MARKET_WASM).await).await?;

    let owner = sandbox.dev_create_account().await?;
    let alice = sandbox.dev_create_account().await?;
    let bob = sandbox.dev_create_account().await?;

    // Init USDC
    usdc.call("new")
        .args_json(json!({ "owner": owner.id(), "total_supply": "0" }))
        .transact().await?.into_result()?;

    // Init outcome token
    outcome_token.call("new")
        .args_json(json!({ "market_contract": market.id() }))
        .transact().await?.into_result()?;

    // Init market (using market as oracle placeholder)
    market.call("new")
        .args_json(json!({
            "owner": owner.id(),
            "usdc_token": usdc.id(),
            "outcome_token": outcome_token.id(),
            "oracle": market.id(),
        }))
        .transact().await?.into_result()?;

    // Storage deposits
    storage_deposit(&alice, &usdc).await?;
    storage_deposit(&bob, &usdc).await?;
    storage_deposit(market.as_account(), &usdc).await?;

    // Mint USDC
    owner.call(usdc.id(), "mint")
        .args_json(json!({ "account_id": alice.id(), "amount": (2000 * USDC_ONE).to_string() }))
        .transact().await?.into_result()?;
    owner.call(usdc.id(), "mint")
        .args_json(json!({ "account_id": bob.id(), "amount": (1000 * USDC_ONE).to_string() }))
        .transact().await?.into_result()?;

    Ok(TestSetup { usdc, outcome_token, market, owner, alice, bob })
}

fn future_time_ns() -> u64 {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap()
        .as_nanos() as u64) + 86_400_000_000_000 // +24h
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_create_market() -> anyhow::Result<()> {
    let s = setup().await?;

    let result = ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Will ETH hit $10k?",
        "description": "Resolves YES if ETH > $10k on Coinbase.",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?;
    assert!(result.is_success(), "CreateMarket failed: {:?}", result.failures());

    // Verify market exists
    let count: u64 = s.market.view("get_market_count").args_json(json!({})).await?.json()?;
    assert_eq!(count, 1);

    let mv: serde_json::Value = s.market.view("get_market")
        .args_json(json!({ "market_id": 0 })).await?.json()?;
    assert_eq!(mv["question"], "Will ETH hit $10k?");
    assert_eq!(mv["status"], "Open");

    // Prices should be 50/50
    let (yp, np): (String, String) = s.market.view("get_prices")
        .args_json(json!({ "market_id": 0 })).await?.json()?;
    assert_eq!(yp, "500000");
    assert_eq!(np, "500000");

    // Alice LP shares = initial liquidity
    let lp: String = s.market.view("get_lp_shares")
        .args_json(json!({ "market_id": 0, "account_id": s.alice.id() })).await?.json()?;
    assert_eq!(lp.parse::<u128>().unwrap(), 100 * USDC_ONE);

    // Alice USDC deducted
    assert_eq!(ft_balance(&s.usdc, s.alice.id()).await?, (2000 - 100) * USDC_ONE);

    println!("test_create_market PASSED");
    Ok(())
}

#[tokio::test]
async fn test_buy_yes_moves_price() -> anyhow::Result<()> {
    let s = setup().await?;

    // Create market
    ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Test?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?.into_result()?;

    // Buy YES
    let result = ft_transfer_call(&s.bob, &s.usdc, &s.market, 50 * USDC_ONE, &json!({
        "action": "Buy",
        "market_id": 0,
        "outcome": "Yes",
        "min_tokens_out": "0",
    })).await?;
    assert!(result.is_success(), "Buy failed: {:?}", result.failures());

    // YES price should be > 0.5
    let (yp, np): (String, String) = s.market.view("get_prices")
        .args_json(json!({ "market_id": 0 })).await?.json()?;
    let yes_price: u128 = yp.parse().unwrap();
    let no_price: u128 = np.parse().unwrap();
    assert!(yes_price > 500_000, "YES price should increase: {}", yes_price);
    assert!(no_price < 500_000, "NO price should decrease: {}", no_price);
    println!("After buy YES: yes={}, no={}", yes_price, no_price);

    // Bob should have YES tokens
    let bob_yes = outcome_balance(&s.outcome_token, 0, "Yes", s.bob.id()).await?;
    assert!(bob_yes > 0, "Bob should have YES tokens: {}", bob_yes);
    println!("Bob YES tokens: {}", bob_yes);

    println!("test_buy_yes_moves_price PASSED");
    Ok(())
}

#[tokio::test]
async fn test_buy_no_moves_price() -> anyhow::Result<()> {
    let s = setup().await?;

    ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Test?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?.into_result()?;

    // Buy NO
    ft_transfer_call(&s.bob, &s.usdc, &s.market, 50 * USDC_ONE, &json!({
        "action": "Buy",
        "market_id": 0,
        "outcome": "No",
        "min_tokens_out": "0",
    })).await?.into_result()?;

    let (yp, np): (String, String) = s.market.view("get_prices")
        .args_json(json!({ "market_id": 0 })).await?.json()?;
    let yes_price: u128 = yp.parse().unwrap();
    let no_price: u128 = np.parse().unwrap();
    assert!(yes_price < 500_000, "YES should decrease after NO buy: {}", yes_price);
    assert!(no_price > 500_000, "NO should increase after NO buy: {}", no_price);

    let bob_no = outcome_balance(&s.outcome_token, 0, "No", s.bob.id()).await?;
    assert!(bob_no > 0);
    println!("test_buy_no_moves_price PASSED");
    Ok(())
}

#[tokio::test]
async fn test_sell_flow() -> anyhow::Result<()> {
    let s = setup().await?;

    ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Sell test?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?.into_result()?;

    // Buy YES
    ft_transfer_call(&s.alice, &s.usdc, &s.market, 50 * USDC_ONE, &json!({
        "action": "Buy",
        "market_id": 0,
        "outcome": "Yes",
        "min_tokens_out": "0",
    })).await?.into_result()?;

    let alice_yes = outcome_balance(&s.outcome_token, 0, "Yes", s.alice.id()).await?;
    assert!(alice_yes > 0);

    let usdc_before = ft_balance(&s.usdc, s.alice.id()).await?;

    // Sell half
    let sell_amount = alice_yes / 2;
    let result = s.alice.call(s.market.id(), "sell")
        .args_json(json!({
            "market_id": 0,
            "outcome": "Yes",
            "tokens_in": sell_amount.to_string(),
            "min_collateral_out": "0",
        }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact().await?;
    assert!(result.is_success(), "Sell failed: {:?}", result.failures());

    let usdc_after = ft_balance(&s.usdc, s.alice.id()).await?;
    assert!(usdc_after > usdc_before, "Should receive USDC back: before={}, after={}", usdc_before, usdc_after);
    println!("Sell: gained {} USDC", usdc_after - usdc_before);

    println!("test_sell_flow PASSED");
    Ok(())
}

#[tokio::test]
async fn test_add_remove_liquidity() -> anyhow::Result<()> {
    let s = setup().await?;

    ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "LP test?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?.into_result()?;

    // Bob adds liquidity
    let result = ft_transfer_call(&s.bob, &s.usdc, &s.market, 50 * USDC_ONE, &json!({
        "action": "AddLiquidity",
        "market_id": 0,
    })).await?;
    assert!(result.is_success(), "AddLiquidity failed: {:?}", result.failures());

    let bob_lp: String = s.market.view("get_lp_shares")
        .args_json(json!({ "market_id": 0, "account_id": s.bob.id() })).await?.json()?;
    let bob_shares: u128 = bob_lp.parse().unwrap();
    assert!(bob_shares > 0);

    // Bob removes liquidity
    let usdc_before = ft_balance(&s.usdc, s.bob.id()).await?;
    let result = s.bob.call(s.market.id(), "remove_liquidity")
        .args_json(json!({
            "market_id": 0,
            "shares": bob_shares.to_string(),
        }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact().await?;
    assert!(result.is_success(), "RemoveLiquidity failed: {:?}", result.failures());

    let usdc_after = ft_balance(&s.usdc, s.bob.id()).await?;
    assert!(usdc_after > usdc_before, "Should receive USDC back after removing liquidity");

    let bob_lp_after: String = s.market.view("get_lp_shares")
        .args_json(json!({ "market_id": 0, "account_id": s.bob.id() })).await?.json()?;
    assert_eq!(bob_lp_after.parse::<u128>().unwrap(), 0, "LP shares should be 0 after full removal");

    println!("test_add_remove_liquidity PASSED");
    Ok(())
}

#[tokio::test]
async fn test_min_liquidity_enforced() -> anyhow::Result<()> {
    let s = setup().await?;

    // Try to create market with only 1 USDC (below 10 USDC minimum)
    let result = ft_transfer_call(&s.alice, &s.usdc, &s.market, 1 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Too little liquidity?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?;

    // ft_transfer_call succeeds at the NEP-141 level (tokens get refunded),
    // but no market should have been created
    let count: u64 = s.market.view("get_market_count").args_json(json!({})).await?.json()?;
    assert_eq!(count, 0, "No market should have been created");

    // Alice should still have all her USDC (refunded)
    let balance = ft_balance(&s.usdc, s.alice.id()).await?;
    assert_eq!(balance, 2000 * USDC_ONE, "USDC should be fully refunded");
    println!("test_min_liquidity_enforced PASSED");
    Ok(())
}

#[tokio::test]
async fn test_estimate_buy_matches_actual() -> anyhow::Result<()> {
    let s = setup().await?;

    ft_transfer_call(&s.alice, &s.usdc, &s.market, 100 * USDC_ONE, &json!({
        "action": "CreateMarket",
        "question": "Estimate test?",
        "description": "",
        "resolution_time_ns": future_time_ns().to_string(),
    })).await?.into_result()?;

    // Get estimate
    let estimate: String = s.market.view("estimate_buy")
        .args_json(json!({
            "market_id": 0,
            "outcome": "Yes",
            "collateral_in": (20 * USDC_ONE).to_string(),
        })).await?.json()?;
    let estimated_tokens: u128 = estimate.parse().unwrap();

    // Actually buy
    ft_transfer_call(&s.bob, &s.usdc, &s.market, 20 * USDC_ONE, &json!({
        "action": "Buy",
        "market_id": 0,
        "outcome": "Yes",
        "min_tokens_out": "0",
    })).await?.into_result()?;

    let actual_tokens = outcome_balance(&s.outcome_token, 0, "Yes", s.bob.id()).await?;

    // They should match (or be very close — within 1 token due to rounding)
    let diff = if actual_tokens > estimated_tokens {
        actual_tokens - estimated_tokens
    } else {
        estimated_tokens - actual_tokens
    };
    assert!(diff <= 1, "Estimate {} vs actual {} differ by {}", estimated_tokens, actual_tokens, diff);

    println!("test_estimate_buy_matches_actual PASSED (est={}, actual={})", estimated_tokens, actual_tokens);
    Ok(())
}
