use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use json_filter::{Filter, Operator};
use log::{error, info, warn};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::db::{
    insert_market_event, insert_price_point, upsert_market_projection, DbPool, EventInsert,
    ProjectionUpdate,
};
use crate::types::{
    ns_string_to_ms, price_raw_to_float, LiquidityAddedEvent, LiquidityRemovedEvent, LiveTradeEvent,
    LiveWsMessage, LogNep297Event, MarketCreatedEvent, MarketDisputedEvent, MarketSettledEvent,
    RedeemedEvent, ResolutionSubmittedEvent, TradeEvent,
};

#[derive(Clone)]
pub struct EventListenerConfig {
    pub market_contract_id: String,
    pub event_standard: String,
    pub is_testnet: bool,
}

fn build_filter(config: &EventListenerConfig) -> Operator {
    Operator::And(vec![
        Filter {
            path: "account_id".to_string(),
            operator: Operator::Equals(serde_json::Value::String(config.market_contract_id.clone())),
        },
        Filter {
            path: "event_standard".to_string(),
            operator: Operator::Equals(serde_json::Value::String(config.event_standard.clone())),
        },
        Filter {
            path: ".".to_string(),
            operator: Operator::Or(vec![
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("market_created".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("trade".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("liquidity_added".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("liquidity_removed".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("resolution_submitted".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("market_disputed".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("market_settled".to_string())),
                },
                Filter {
                    path: "event_event".to_string(),
                    operator: Operator::Equals(serde_json::Value::String("redeemed".to_string())),
                },
            ]),
        },
    ])
}

fn get_ws_url(is_testnet: bool) -> String {
    if is_testnet {
        "wss://ws-events-v3-testnet.intear.tech/events/log_nep297".to_string()
    } else {
        "wss://ws-events-v3.intear.tech/events/log_nep297".to_string()
    }
}

pub async fn listen_to_market_events(
    pool: Arc<DbPool>,
    broadcaster: broadcast::Sender<LiveWsMessage>,
    config: &EventListenerConfig,
) -> Result<()> {
    let ws_url = get_ws_url(config.is_testnet);
    info!(
        "Connecting to Intear WebSocket: {} for contract: {}",
        ws_url, config.market_contract_id
    );

    let (ws_stream, _response) = connect_async(&ws_url).await?;
    let (mut write, mut read) = ws_stream.split();

    info!("Connected to Intear WebSocket");

    let filter = build_filter(config);
    let filter_json = serde_json::to_string(&filter)?;
    info!("Sending filter: {}", filter_json);
    write.send(Message::Text(filter_json)).await?;

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => match serde_json::from_str::<Vec<LogNep297Event>>(&text) {
                Ok(events) => {
                    for event in events {
                        if let Err(e) = handle_event(&pool, &broadcaster, event).await {
                            error!("Error handling event: {}", e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to parse events: {} - raw: {}", e, text);
                }
            },
            Ok(Message::Ping(data)) => {
                if let Err(e) = write.send(Message::Pong(data)).await {
                    error!("Failed to send pong: {}", e);
                }
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(_)) => {
                warn!("WebSocket closed by server");
                break;
            }
            Ok(Message::Binary(_)) => {
                warn!("Received unexpected binary message");
            }
            Ok(Message::Frame(_)) => {}
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

async fn handle_event(
    pool: &DbPool,
    broadcaster: &broadcast::Sender<LiveWsMessage>,
    event: LogNep297Event,
) -> Result<()> {
    let event_data = match &event.event_data {
        Some(data) => data,
        None => {
            warn!("Event {} has no data", event.event_event);
            return Ok(());
        }
    };

    let event_data_inner = match event_data {
        serde_json::Value::Array(arr) if !arr.is_empty() => &arr[0],
        _ => event_data,
    };

    let event_json = serde_json::to_string(event_data_inner)?;

    match event.event_event.as_str() {
        "market_created" => {
            let payload: MarketCreatedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "open",
                None,
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "trade" => {
            let payload: TradeEvent = serde_json::from_value(event_data_inner.clone())?;
            let inserted = process_generic_event(
                pool,
                &event,
                payload.market_id,
                "open",
                None,
                Some(payload.yes_price.clone()),
                Some(payload.no_price.clone()),
                &event_json,
            )
            .await?;

            if inserted {
                insert_price_point(
                    pool,
                    &payload,
                    event.block_height,
                    &event.block_timestamp_nanosec,
                    &event.transaction_id,
                    &event.receipt_id,
                )
                .await?;

                let live_message = LiveWsMessage::Trade {
                    data: LiveTradeEvent {
                        market_id: payload.market_id,
                        block_height: event.block_height,
                        block_timestamp_ns: event.block_timestamp_nanosec.clone(),
                        timestamp_ms: ns_string_to_ms(&event.block_timestamp_nanosec),
                        transaction_id: event.transaction_id.clone(),
                        receipt_id: event.receipt_id.clone(),
                        trader: payload.trader.clone(),
                        outcome: payload.outcome.as_str().to_string(),
                        is_buy: payload.is_buy,
                        collateral_amount: payload.collateral_amount.clone(),
                        token_amount: payload.token_amount.clone(),
                        yes_price: payload.yes_price.clone(),
                        no_price: payload.no_price.clone(),
                        yes: price_raw_to_float(&payload.yes_price),
                        no: price_raw_to_float(&payload.no_price),
                    },
                };
                let _ = broadcaster.send(live_message);
            }
        }
        "liquidity_added" => {
            let payload: LiquidityAddedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "open",
                None,
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "liquidity_removed" => {
            let payload: LiquidityRemovedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "open",
                None,
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "resolution_submitted" => {
            let payload: ResolutionSubmittedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "resolving",
                Some(payload.outcome.as_str().to_string()),
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "market_disputed" => {
            let payload: MarketDisputedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "disputed",
                None,
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "market_settled" => {
            let payload: MarketSettledEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "settled",
                Some(payload.outcome.as_str().to_string()),
                None,
                None,
                &event_json,
            )
            .await?;
        }
        "redeemed" => {
            let payload: RedeemedEvent = serde_json::from_value(event_data_inner.clone())?;
            process_generic_event(
                pool,
                &event,
                payload.market_id,
                "settled",
                None,
                None,
                None,
                &event_json,
            )
            .await?;
        }
        _ => {
            warn!("Ignoring unknown event type: {}", event.event_event);
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn process_generic_event(
    pool: &DbPool,
    event: &LogNep297Event,
    market_id: u64,
    status: &str,
    outcome: Option<String>,
    latest_yes_price: Option<String>,
    latest_no_price: Option<String>,
    event_json: &str,
) -> Result<bool> {
    let insert = EventInsert {
        market_id,
        event_type: event.event_event.clone(),
        block_height: event.block_height,
        block_timestamp_ns: event.block_timestamp_nanosec.clone(),
        transaction_id: event.transaction_id.clone(),
        receipt_id: event.receipt_id.clone(),
        event_json: event_json.to_string(),
    };

    let inserted = insert_market_event(pool, &insert).await?;
    if !inserted {
        return Ok(false);
    }

    let projection = ProjectionUpdate {
        market_id,
        status: status.to_string(),
        outcome,
        latest_yes_price,
        latest_no_price,
        updated_block_height: event.block_height,
    };
    upsert_market_projection(pool, &projection).await?;

    Ok(true)
}

pub async fn start_event_listener(
    pool: Arc<DbPool>,
    broadcaster: broadcast::Sender<LiveWsMessage>,
    config: EventListenerConfig,
) {
    loop {
        match listen_to_market_events(pool.clone(), broadcaster.clone(), &config).await {
            Ok(_) => warn!("WebSocket connection closed normally"),
            Err(e) => error!("WebSocket error: {}", e),
        }

        warn!("Reconnecting to WebSocket in 5 seconds...");
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}
