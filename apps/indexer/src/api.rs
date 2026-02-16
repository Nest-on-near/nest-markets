use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::{self, DbPool};
use crate::types::{
    HealthResponse, LimitQuery, LiveWsMessage, MarketActivityResponse, PriceHistoryResponse,
    TradesResponse,
};

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
        .route("/docs", get(api_docs))
        .route("/openapi.json", get(openapi_spec))
        .route("/health", get(health_check))
        .route("/markets/:id/price-history", get(get_price_history))
        .route("/markets/:id/trades", get(get_trades))
        .route("/markets/:id/activity", get(get_market_activity))
        .route("/markets/:id/resolution-status", get(get_resolution_status))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn api_docs() -> Html<&'static str> {
    Html(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nest Markets Indexer API Docs</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111827; }
      code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 0.25rem; }
      pre { background: #f9fafb; border: 1px solid #e5e7eb; padding: 0.8rem; border-radius: 0.5rem; overflow-x: auto; }
      h1, h2 { margin-bottom: 0.5rem; }
      ul { margin-top: 0.4rem; }
    </style>
  </head>
  <body>
    <h1>Nest Markets Indexer API</h1>
    <p>OpenAPI JSON: <a href="/openapi.json"><code>/openapi.json</code></a></p>

    <h2>Endpoints</h2>
    <ul>
      <li><code>GET /health</code></li>
      <li><code>GET /markets/{id}/price-history?limit=200</code></li>
      <li><code>GET /markets/{id}/trades?limit=50</code></li>
      <li><code>GET /markets/{id}/activity?limit=100</code></li>
      <li><code>GET /markets/{id}/resolution-status</code></li>
      <li><code>GET /ws?market_id={id}</code></li>
    </ul>

    <h2>Examples</h2>
    <pre>curl http://127.0.0.1:3002/health
curl "http://127.0.0.1:3002/markets/0/price-history?limit=200"
curl "http://127.0.0.1:3002/markets/0/trades?limit=50"
curl "http://127.0.0.1:3002/markets/0/activity?limit=100"
curl "http://127.0.0.1:3002/markets/0/resolution-status"</pre>
  </body>
</html>
"#,
    )
}

async fn openapi_spec() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Nest Markets Indexer API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "REST API for market history, activity, and real-time trade streams."
        },
        "servers": [{ "url": "http://127.0.0.1:3002" }],
        "paths": {
            "/health": {
                "get": {
                    "summary": "Health check",
                    "responses": { "200": { "description": "Service health and indexing status" } }
                }
            },
            "/markets/{id}/price-history": {
                "get": {
                    "summary": "Get market price history",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 2000 } }
                    ],
                    "responses": { "200": { "description": "Price history points" } }
                }
            },
            "/markets/{id}/trades": {
                "get": {
                    "summary": "Get recent market trades",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 500 } }
                    ],
                    "responses": { "200": { "description": "Trade list" } }
                }
            },
            "/markets/{id}/activity": {
                "get": {
                    "summary": "Get market activity feed",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 1000 } }
                    ],
                    "responses": { "200": { "description": "Activity feed" } }
                }
            },
            "/markets/{id}/resolution-status": {
                "get": {
                    "summary": "Get market resolution/dispute status",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }
                    ],
                    "responses": {
                        "200": { "description": "Resolution status" },
                        "404": { "description": "Market not found" }
                    }
                }
            },
            "/ws": {
                "get": {
                    "summary": "WebSocket stream of live trades",
                    "parameters": [
                        { "name": "market_id", "in": "query", "schema": { "type": "integer" } }
                    ],
                    "responses": {
                        "101": { "description": "WebSocket upgrade accepted" }
                    }
                }
            }
        }
    }))
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
            log::error!(
                "Error getting price history for market {}: {}",
                market_id,
                e
            );
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

async fn get_market_activity(
    State(state): State<AppState>,
    Path(market_id): Path<u64>,
    Query(query): Query<LimitQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);

    match db::get_market_activity(&state.pool, market_id, limit).await {
        Ok(items) => Json(MarketActivityResponse { market_id, items }).into_response(),
        Err(e) => {
            log::error!("Error getting activity for market {}: {}", market_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

async fn get_resolution_status(
    State(state): State<AppState>,
    Path(market_id): Path<u64>,
) -> impl IntoResponse {
    match db::get_resolution_status(&state.pool, market_id).await {
        Ok(Some(status)) => Json(status).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "market not found" })),
        )
            .into_response(),
        Err(e) => {
            log::error!(
                "Error getting resolution status for market {}: {}",
                market_id,
                e
            );
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
    ws.on_upgrade(move |socket| {
        handle_socket(socket, state.broadcaster.subscribe(), query.market_id)
    })
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
