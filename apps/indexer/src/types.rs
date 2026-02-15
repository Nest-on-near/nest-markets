use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogNep297Event {
    pub block_height: u64,
    pub block_timestamp_nanosec: String,
    pub transaction_id: String,
    pub receipt_id: String,
    pub account_id: String,
    pub predecessor_id: String,
    pub event_standard: String,
    pub event_version: String,
    pub event_event: String,
    pub event_data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Outcome {
    Yes,
    No,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Yes => "Yes",
            Outcome::No => "No",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketCreatedEvent {
    pub market_id: u64,
    pub question: String,
    pub resolution_time_ns: String,
    pub creator: String,
    pub initial_liquidity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeEvent {
    pub market_id: u64,
    pub trader: String,
    pub outcome: Outcome,
    pub is_buy: bool,
    pub collateral_amount: String,
    pub token_amount: String,
    pub yes_price: String,
    pub no_price: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidityAddedEvent {
    pub market_id: u64,
    pub provider: String,
    pub amount: String,
    pub lp_shares: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidityRemovedEvent {
    pub market_id: u64,
    pub provider: String,
    pub amount: String,
    pub lp_shares: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolutionSubmittedEvent {
    pub market_id: u64,
    pub outcome: Outcome,
    pub resolver: String,
    pub assertion_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDisputedEvent {
    pub market_id: u64,
    pub assertion_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSettledEvent {
    pub market_id: u64,
    pub outcome: Outcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedeemedEvent {
    pub market_id: u64,
    pub user: String,
    pub collateral_out: String,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub market_events_count: i64,
    pub price_points_count: i64,
    pub last_block_height: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct PriceHistoryPoint {
    pub block_height: u64,
    pub timestamp_ms: i64,
    pub yes: f64,
    pub no: f64,
    pub yes_raw: String,
    pub no_raw: String,
}

#[derive(Debug, Serialize)]
pub struct PriceHistoryResponse {
    pub market_id: u64,
    pub points: Vec<PriceHistoryPoint>,
}

#[derive(Debug, Serialize)]
pub struct TradeResponseItem {
    pub block_height: u64,
    pub timestamp_ms: i64,
    pub transaction_id: String,
    pub trader: String,
    pub outcome: String,
    pub is_buy: bool,
    pub collateral_amount: String,
    pub token_amount: String,
    pub yes_price: String,
    pub no_price: String,
}

#[derive(Debug, Serialize)]
pub struct TradesResponse {
    pub market_id: u64,
    pub trades: Vec<TradeResponseItem>,
}

#[derive(Debug, Serialize)]
pub struct MarketActivityItem {
    pub event_type: String,
    pub block_height: u64,
    pub block_timestamp_ns: String,
    pub timestamp_ms: i64,
    pub transaction_id: String,
    pub receipt_id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct MarketActivityResponse {
    pub market_id: u64,
    pub items: Vec<MarketActivityItem>,
}

#[derive(Debug, Serialize)]
pub struct ResolutionStatusResponse {
    pub market_id: u64,
    pub status: String,
    pub outcome: Option<String>,
    pub assertion_id: Option<String>,
    pub resolver: Option<String>,
    pub disputer: Option<String>,
    pub submitted_block_height: Option<u64>,
    pub disputed_block_height: Option<u64>,
    pub settled_block_height: Option<u64>,
    pub submitted_timestamp_ns: Option<String>,
    pub disputed_timestamp_ns: Option<String>,
    pub settled_timestamp_ns: Option<String>,
    pub liveness_deadline_ns: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveTradeEvent {
    pub market_id: u64,
    pub block_height: u64,
    pub block_timestamp_ns: String,
    pub timestamp_ms: i64,
    pub transaction_id: String,
    pub receipt_id: String,
    pub trader: String,
    pub outcome: String,
    pub is_buy: bool,
    pub collateral_amount: String,
    pub token_amount: String,
    pub yes_price: String,
    pub no_price: String,
    pub yes: f64,
    pub no: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LiveWsMessage {
    Trade { data: LiveTradeEvent },
}

pub fn ns_string_to_ms(ns: &str) -> i64 {
    ns.parse::<i128>()
        .map(|v| (v / 1_000_000) as i64)
        .unwrap_or(0)
}

pub fn price_raw_to_float(raw: &str) -> f64 {
    raw.parse::<u128>()
        .map(|v| (v as f64) / 10_000.0)
        .unwrap_or(0.0)
}
