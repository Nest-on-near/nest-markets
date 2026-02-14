use anyhow::Result;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::{
    ns_string_to_ms, price_raw_to_float, PriceHistoryPoint, TradeEvent, TradeResponseItem,
};

pub type DbPool = Pool<Sqlite>;

#[derive(Debug, Clone)]
pub struct EventInsert {
    pub market_id: u64,
    pub event_type: String,
    pub block_height: u64,
    pub block_timestamp_ns: String,
    pub transaction_id: String,
    pub receipt_id: String,
    pub event_json: String,
}

#[derive(Debug, Clone)]
pub struct ProjectionUpdate {
    pub market_id: u64,
    pub status: String,
    pub outcome: Option<String>,
    pub latest_yes_price: Option<String>,
    pub latest_no_price: Option<String>,
    pub updated_block_height: u64,
}

fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub async fn init_db(database_url: &str) -> Result<DbPool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS market_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            block_height INTEGER NOT NULL,
            block_timestamp_ns TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            event_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_market_events_dedupe ON market_events(receipt_id, event_type, market_id)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS market_price_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id INTEGER NOT NULL,
            yes_price TEXT NOT NULL,
            no_price TEXT NOT NULL,
            collateral_amount TEXT NOT NULL,
            token_amount TEXT NOT NULL,
            is_buy INTEGER NOT NULL,
            outcome TEXT NOT NULL,
            trader TEXT NOT NULL,
            block_height INTEGER NOT NULL,
            block_timestamp_ns TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_market_price_points_dedupe ON market_price_points(receipt_id, market_id)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_market_price_points_read ON market_price_points(market_id, block_height, id)",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS markets_projection (
            market_id INTEGER PRIMARY KEY,
            status TEXT,
            outcome TEXT,
            latest_yes_price TEXT,
            latest_no_price TEXT,
            updated_block_height INTEGER,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

pub async fn insert_market_event(pool: &DbPool, event: &EventInsert) -> Result<bool> {
    let result = sqlx::query(
        r#"
        INSERT OR IGNORE INTO market_events (
            market_id, event_type, block_height, block_timestamp_ns,
            transaction_id, receipt_id, event_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(event.market_id as i64)
    .bind(&event.event_type)
    .bind(event.block_height as i64)
    .bind(&event.block_timestamp_ns)
    .bind(&event.transaction_id)
    .bind(&event.receipt_id)
    .bind(&event.event_json)
    .bind(now_timestamp())
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn insert_price_point(
    pool: &DbPool,
    trade: &TradeEvent,
    block_height: u64,
    block_timestamp_ns: &str,
    transaction_id: &str,
    receipt_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO market_price_points (
            market_id, yes_price, no_price, collateral_amount, token_amount,
            is_buy, outcome, trader, block_height, block_timestamp_ns,
            transaction_id, receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(trade.market_id as i64)
    .bind(&trade.yes_price)
    .bind(&trade.no_price)
    .bind(&trade.collateral_amount)
    .bind(&trade.token_amount)
    .bind(if trade.is_buy { 1 } else { 0 })
    .bind(trade.outcome.as_str())
    .bind(&trade.trader)
    .bind(block_height as i64)
    .bind(block_timestamp_ns)
    .bind(transaction_id)
    .bind(receipt_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn upsert_market_projection(pool: &DbPool, update: &ProjectionUpdate) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO markets_projection (
            market_id, status, outcome, latest_yes_price, latest_no_price,
            updated_block_height, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            status = excluded.status,
            outcome = COALESCE(excluded.outcome, markets_projection.outcome),
            latest_yes_price = COALESCE(excluded.latest_yes_price, markets_projection.latest_yes_price),
            latest_no_price = COALESCE(excluded.latest_no_price, markets_projection.latest_no_price),
            updated_block_height = excluded.updated_block_height,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(update.market_id as i64)
    .bind(&update.status)
    .bind(&update.outcome)
    .bind(&update.latest_yes_price)
    .bind(&update.latest_no_price)
    .bind(update.updated_block_height as i64)
    .bind(now_timestamp())
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_market_events_count(pool: &DbPool) -> Result<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM market_events")
        .fetch_one(pool)
        .await?;
    Ok(count)
}

pub async fn get_price_points_count(pool: &DbPool) -> Result<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM market_price_points")
        .fetch_one(pool)
        .await?;
    Ok(count)
}

pub async fn get_last_block_height(pool: &DbPool) -> Result<Option<u64>> {
    let result: Option<(i64,)> = sqlx::query_as("SELECT MAX(block_height) FROM market_events")
        .fetch_optional(pool)
        .await?;

    Ok(result.and_then(|(h,)| if h > 0 { Some(h as u64) } else { None }))
}

pub async fn get_price_history(
    pool: &DbPool,
    market_id: u64,
    limit: u32,
) -> Result<Vec<PriceHistoryPoint>> {
    let rows = sqlx::query_as::<_, PricePointRow>(
        r#"
        SELECT *
        FROM (
            SELECT
                id as _row_id, block_height, block_timestamp_ns, yes_price, no_price
            FROM market_price_points
            WHERE market_id = ?
            ORDER BY block_height DESC, id DESC
            LIMIT ?
        ) recent
        ORDER BY block_height ASC, _row_id ASC
        "#,
    )
    .bind(market_id as i64)
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PriceHistoryPoint {
            block_height: row.block_height as u64,
            timestamp_ms: ns_string_to_ms(&row.block_timestamp_ns),
            yes: price_raw_to_float(&row.yes_price),
            no: price_raw_to_float(&row.no_price),
            yes_raw: row.yes_price,
            no_raw: row.no_price,
        })
        .collect())
}

pub async fn get_trades(pool: &DbPool, market_id: u64, limit: u32) -> Result<Vec<TradeResponseItem>> {
    let rows = sqlx::query_as::<_, TradeRow>(
        r#"
        SELECT
            id as _row_id, block_height, block_timestamp_ns, transaction_id, trader,
            outcome, is_buy, collateral_amount, token_amount, yes_price, no_price
        FROM market_price_points
        WHERE market_id = ?
        ORDER BY block_height DESC, id DESC
        LIMIT ?
        "#,
    )
    .bind(market_id as i64)
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| TradeResponseItem {
            block_height: row.block_height as u64,
            timestamp_ms: ns_string_to_ms(&row.block_timestamp_ns),
            transaction_id: row.transaction_id,
            trader: row.trader,
            outcome: row.outcome,
            is_buy: row.is_buy != 0,
            collateral_amount: row.collateral_amount,
            token_amount: row.token_amount,
            yes_price: row.yes_price,
            no_price: row.no_price,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct PricePointRow {
    _row_id: i64,
    block_height: i64,
    block_timestamp_ns: String,
    yes_price: String,
    no_price: String,
}

#[derive(sqlx::FromRow)]
struct TradeRow {
    _row_id: i64,
    block_height: i64,
    block_timestamp_ns: String,
    transaction_id: String,
    trader: String,
    outcome: String,
    is_buy: i64,
    collateral_amount: String,
    token_amount: String,
    yes_price: String,
    no_price: String,
}
