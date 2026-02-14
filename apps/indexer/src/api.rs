use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::{self, DbPool};
use crate::types::{HealthResponse, LimitQuery, LiveWsMessage, PriceHistoryResponse, TradesResponse};

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<DbPool>,
    pub broadcaster: broadcast::Sender<LiveWsMessage>,
}

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    market_id: Option<u64>,
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_check))
        .route("/markets/:id/price-history", get(get_price_history))
        .route("/markets/:id/trades", get(get_trades))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    let market_events_count = db::get_market_events_count(&state.pool).await.unwrap_or(0);
    let price_points_count = db::get_price_points_count(&state.pool).await.unwrap_or(0);
    let last_block_height = db::get_last_block_height(&state.pool).await.ok().flatten();

    Json(HealthResponse {
        status: "ok".to_string(),
        market_events_count,
        price_points_count,
        last_block_height,
    })
}

async fn get_price_history(
    State(state): State<AppState>,
    Path(market_id): Path<u64>,
    Query(query): Query<LimitQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(200).clamp(1, 2000);

    match db::get_price_history(&state.pool, market_id, limit).await {
        Ok(points) => Json(PriceHistoryResponse { market_id, points }).into_response(),
        Err(e) => {
            log::error!("Error getting price history for market {}: {}", market_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

async fn get_trades(
    State(state): State<AppState>,
    Path(market_id): Path<u64>,
    Query(query): Query<LimitQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);

    match db::get_trades(&state.pool, market_id, limit).await {
        Ok(trades) => Json(TradesResponse { market_id, trades }).into_response(),
        Err(e) => {
            log::error!("Error getting trades for market {}: {}", market_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state.broadcaster.subscribe(), query.market_id))
}

async fn handle_socket(
    mut socket: WebSocket,
    mut receiver: broadcast::Receiver<LiveWsMessage>,
    market_filter: Option<u64>,
) {
    loop {
        tokio::select! {
            inbound = socket.next() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            outbound = receiver.recv() => {
                match outbound {
                    Ok(message) => {
                        let market_id = match &message {
                            LiveWsMessage::Trade { data } => data.market_id,
                        };
                        if market_filter.is_some() && market_filter != Some(market_id) {
                            continue;
                        }

                        let payload = match serde_json::to_string(&message) {
                            Ok(payload) => payload,
                            Err(_) => continue,
                        };

                        if socket.send(Message::Text(payload)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}
