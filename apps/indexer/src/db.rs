use anyhow::Result;
use sqlx::{any::AnyPoolOptions, Any, Pool, QueryBuilder};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::{
    ns_string_to_ms, price_raw_to_float, MarketActivityItem, PriceHistoryPoint,
    ResolutionStatusResponse, TradeEvent, TradeResponseItem,
};

pub type DbPool = Pool<Any>;

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

#[derive(Debug, Clone)]
pub struct LifecycleProjectionUpdate {
    pub market_id: u64,
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

fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub async fn init_db(database_url: &str) -> Result<DbPool> {
    let pool = AnyPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    let is_postgres = database_url.starts_with("postgres://")
        || database_url.starts_with("postgresql://");

    let market_events_ddl = if is_postgres {
        r#"
        CREATE TABLE IF NOT EXISTS market_events (
            id BIGSERIAL PRIMARY KEY,
            market_id BIGINT NOT NULL,
            event_type TEXT NOT NULL,
            block_height BIGINT NOT NULL,
            block_timestamp_ns TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            event_json TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
        "#
    } else {
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
        "#
    };
    sqlx::query(market_events_ddl)
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_market_events_dedupe ON market_events(receipt_id, event_type, market_id)",
    )
    .execute(&pool)
    .await?;

    let market_price_points_ddl = if is_postgres {
        r#"
        CREATE TABLE IF NOT EXISTS market_price_points (
            id BIGSERIAL PRIMARY KEY,
            market_id BIGINT NOT NULL,
            yes_price TEXT NOT NULL,
            no_price TEXT NOT NULL,
            collateral_amount TEXT NOT NULL,
            token_amount TEXT NOT NULL,
            is_buy INTEGER NOT NULL,
            outcome TEXT NOT NULL,
            trader TEXT NOT NULL,
            block_height BIGINT NOT NULL,
            block_timestamp_ns TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL
        )
        "#
    } else {
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
        "#
    };
    sqlx::query(market_price_points_ddl)
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

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS market_lifecycle_projection (
            market_id INTEGER PRIMARY KEY,
            assertion_id TEXT,
            resolver TEXT,
            disputer TEXT,
            submitted_block_height INTEGER,
            disputed_block_height INTEGER,
            settled_block_height INTEGER,
            submitted_timestamp_ns TEXT,
            disputed_timestamp_ns TEXT,
            settled_timestamp_ns TEXT,
            liveness_deadline_ns TEXT,
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
        INSERT INTO market_events (
            market_id, event_type, block_height, block_timestamp_ns,
            transaction_id, receipt_id, event_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(receipt_id, event_type, market_id) DO NOTHING
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
        INSERT INTO market_price_points (
            market_id, yes_price, no_price, collateral_amount, token_amount,
            is_buy, outcome, trader, block_height, block_timestamp_ns,
            transaction_id, receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(receipt_id, market_id) DO NOTHING
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
    let mut qb = QueryBuilder::<Any>::new(
        r#"
        INSERT INTO markets_projection (
            market_id, status, outcome, latest_yes_price, latest_no_price,
            updated_block_height, updated_at
        ) VALUES ("#,
    );
    qb.push_bind(update.market_id as i64)
        .push(", ")
        .push_bind(&update.status)
        .push(", ")
        .push_bind(&update.outcome)
        .push(", ")
        .push_bind(&update.latest_yes_price)
        .push(", ")
        .push_bind(&update.latest_no_price)
        .push(", ")
        .push_bind(update.updated_block_height as i64)
        .push(", ")
        .push_bind(now_timestamp())
        .push(
            r#")
        ON CONFLICT(market_id) DO UPDATE SET
            status = excluded.status,
            outcome = COALESCE(excluded.outcome, markets_projection.outcome),
            latest_yes_price = COALESCE(excluded.latest_yes_price, markets_projection.latest_yes_price),
            latest_no_price = COALESCE(excluded.latest_no_price, markets_projection.latest_no_price),
            updated_block_height = excluded.updated_block_height,
            updated_at = excluded.updated_at
        "#,
        );
    qb.build().execute(pool).await?;

    Ok(())
}

pub async fn upsert_lifecycle_projection(
    pool: &DbPool,
    update: &LifecycleProjectionUpdate,
) -> Result<()> {
    let mut qb = QueryBuilder::<Any>::new(
        r#"
        INSERT INTO market_lifecycle_projection (
            market_id, assertion_id, resolver, disputer, submitted_block_height,
            disputed_block_height, settled_block_height, submitted_timestamp_ns,
            disputed_timestamp_ns, settled_timestamp_ns, liveness_deadline_ns, updated_at
        ) VALUES ("#,
    );
    qb.push_bind(update.market_id as i64)
        .push(", ")
        .push_bind(&update.assertion_id)
        .push(", ")
        .push_bind(&update.resolver)
        .push(", ")
        .push_bind(&update.disputer)
        .push(", ")
        .push_bind(update.submitted_block_height.map(|v| v as i64))
        .push(", ")
        .push_bind(update.disputed_block_height.map(|v| v as i64))
        .push(", ")
        .push_bind(update.settled_block_height.map(|v| v as i64))
        .push(", ")
        .push_bind(&update.submitted_timestamp_ns)
        .push(", ")
        .push_bind(&update.disputed_timestamp_ns)
        .push(", ")
        .push_bind(&update.settled_timestamp_ns)
        .push(", ")
        .push_bind(&update.liveness_deadline_ns)
        .push(", ")
        .push_bind(now_timestamp())
        .push(
            r#")
        ON CONFLICT(market_id) DO UPDATE SET
            assertion_id = COALESCE(excluded.assertion_id, market_lifecycle_projection.assertion_id),
            resolver = COALESCE(excluded.resolver, market_lifecycle_projection.resolver),
            disputer = COALESCE(excluded.disputer, market_lifecycle_projection.disputer),
            submitted_block_height = COALESCE(excluded.submitted_block_height, market_lifecycle_projection.submitted_block_height),
            disputed_block_height = COALESCE(excluded.disputed_block_height, market_lifecycle_projection.disputed_block_height),
            settled_block_height = COALESCE(excluded.settled_block_height, market_lifecycle_projection.settled_block_height),
            submitted_timestamp_ns = COALESCE(excluded.submitted_timestamp_ns, market_lifecycle_projection.submitted_timestamp_ns),
            disputed_timestamp_ns = COALESCE(excluded.disputed_timestamp_ns, market_lifecycle_projection.disputed_timestamp_ns),
            settled_timestamp_ns = COALESCE(excluded.settled_timestamp_ns, market_lifecycle_projection.settled_timestamp_ns),
            liveness_deadline_ns = COALESCE(excluded.liveness_deadline_ns, market_lifecycle_projection.liveness_deadline_ns),
            updated_at = excluded.updated_at
        "#,
        );
    qb.build().execute(pool).await?;

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
    let sql = format!(
        r#"
        SELECT *
        FROM (
            SELECT
                id as _row_id, block_height, block_timestamp_ns, yes_price, no_price
            FROM market_price_points
            WHERE market_id = {}
            ORDER BY block_height DESC, id DESC
            LIMIT {}
        ) recent
        ORDER BY block_height ASC, _row_id ASC
        "#,
        market_id,
        limit
    );
    let rows = sqlx::query_as::<_, PricePointRow>(&sql).fetch_all(pool).await?;

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

pub async fn get_trades(
    pool: &DbPool,
    market_id: u64,
    limit: u32,
) -> Result<Vec<TradeResponseItem>> {
    let sql = format!(
        r#"
        SELECT
            id as _row_id, block_height, block_timestamp_ns, transaction_id, trader,
            outcome, is_buy, collateral_amount, token_amount, yes_price, no_price
        FROM market_price_points
        WHERE market_id = {}
        ORDER BY block_height DESC, id DESC
        LIMIT {}
        "#,
        market_id,
        limit
    );
    let rows = sqlx::query_as::<_, TradeRow>(&sql).fetch_all(pool).await?;

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

pub async fn get_market_activity(
    pool: &DbPool,
    market_id: u64,
    limit: u32,
) -> Result<Vec<MarketActivityItem>> {
    let sql = format!(
        r#"
        SELECT event_type, block_height, block_timestamp_ns, transaction_id, receipt_id, event_json
        FROM market_events
        WHERE market_id = {}
          AND event_type IN ('resolution_submitted', 'market_disputed', 'market_settled')
        ORDER BY block_height DESC, id DESC
        LIMIT {}
        "#,
        market_id,
        limit
    );
    let rows = sqlx::query_as::<_, MarketActivityRow>(&sql).fetch_all(pool).await?;

    Ok(rows
        .into_iter()
        .map(|row| MarketActivityItem {
            event_type: row.event_type,
            block_height: row.block_height as u64,
            timestamp_ms: ns_string_to_ms(&row.block_timestamp_ns),
            block_timestamp_ns: row.block_timestamp_ns,
            transaction_id: row.transaction_id,
            receipt_id: row.receipt_id,
            data: serde_json::from_str::<serde_json::Value>(&row.event_json)
                .unwrap_or_else(|_| serde_json::json!({})),
        })
        .collect())
}

pub async fn get_resolution_status(
    pool: &DbPool,
    market_id: u64,
) -> Result<Option<ResolutionStatusResponse>> {
    let sql = format!(
        r#"
        SELECT
            p.market_id,
            p.status,
            p.outcome,
            l.assertion_id,
            l.resolver,
            l.disputer,
            l.submitted_block_height,
            l.disputed_block_height,
            l.settled_block_height,
            l.submitted_timestamp_ns,
            l.disputed_timestamp_ns,
            l.settled_timestamp_ns,
            l.liveness_deadline_ns
        FROM markets_projection p
        LEFT JOIN market_lifecycle_projection l ON l.market_id = p.market_id
        WHERE p.market_id = {}
        "#,
        market_id
    );
    let row = sqlx::query_as::<_, ResolutionStatusRow>(&sql)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|row| ResolutionStatusResponse {
        market_id: row.market_id as u64,
        status: row.status.unwrap_or_else(|| "unknown".to_string()),
        outcome: row.outcome,
        assertion_id: row.assertion_id,
        resolver: row.resolver,
        disputer: row.disputer,
        submitted_block_height: row.submitted_block_height.map(|v| v as u64),
        disputed_block_height: row.disputed_block_height.map(|v| v as u64),
        settled_block_height: row.settled_block_height.map(|v| v as u64),
        submitted_timestamp_ns: row.submitted_timestamp_ns,
        disputed_timestamp_ns: row.disputed_timestamp_ns,
        settled_timestamp_ns: row.settled_timestamp_ns,
        liveness_deadline_ns: row.liveness_deadline_ns,
    }))
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

#[derive(sqlx::FromRow)]
struct MarketActivityRow {
    event_type: String,
    block_height: i64,
    block_timestamp_ns: String,
    transaction_id: String,
    receipt_id: String,
    event_json: String,
}

#[derive(sqlx::FromRow)]
struct ResolutionStatusRow {
    market_id: i64,
    status: Option<String>,
    outcome: Option<String>,
    assertion_id: Option<String>,
    resolver: Option<String>,
    disputer: Option<String>,
    submitted_block_height: Option<i64>,
    disputed_block_height: Option<i64>,
    settled_block_height: Option<i64>,
    submitted_timestamp_ns: Option<String>,
    disputed_timestamp_ns: Option<String>,
    settled_timestamp_ns: Option<String>,
    liveness_deadline_ns: Option<String>,
}
