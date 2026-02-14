mod api;
mod config;
mod db;
mod types;
mod ws;

use anyhow::Result;
use log::{info, warn};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::broadcast;

use api::{create_router, AppState};
use config::AppConfig;
use db::init_db;
use ws::{start_event_listener, EventListenerConfig};

#[tokio::main]
async fn main() -> Result<()> {
    if let Err(e) = dotenvy::dotenv() {
        warn!("No .env file found: {}", e);
    }

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let config = AppConfig::from_env();

    info!("Starting Nest Markets Indexer");
    info!("Database: {}", config.database_url);
    info!("Market contract: {}", config.market_contract_id);
    info!("Network: {}", if config.is_testnet { "testnet" } else { "mainnet" });

    let pool = Arc::new(init_db(&config.database_url).await?);
    info!("Database initialized");
    let (broadcaster, _) = broadcast::channel(2048);

    let listener_pool = pool.clone();
    let listener_broadcaster = broadcaster.clone();
    let listener_config = EventListenerConfig {
        market_contract_id: config.market_contract_id,
        event_standard: config.event_standard,
        is_testnet: config.is_testnet,
    };
    tokio::spawn(async move {
        start_event_listener(listener_pool, listener_broadcaster, listener_config).await;
    });

    let state = AppState { pool, broadcaster };
    let app = create_router(state);

    let addr: SocketAddr = config.bind_address.parse()?;
    info!("Starting HTTP server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
