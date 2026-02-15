# Nest Markets Indexer

Rust indexer service for `nest-markets` events. It ingests NEP-297 events from Intear WebSocket, stores canonical events and trade price points in SQLite, and exposes HTTP endpoints for charts and trade history.

## Implemented (V1)

- `GET /health`
- `GET /markets/:id/price-history?limit=200`
- `GET /markets/:id/trades?limit=50`
- `GET /ws?market_id=:id` (WebSocket live trade stream)

Indexed event types:

- `market_created`
- `trade`
- `liquidity_added`
- `liquidity_removed`
- `resolution_submitted`
- `market_disputed`
- `market_settled`
- `redeemed`

## Environment Variables

```bash
DATABASE_URL=sqlite:nest-market-indexer.db?mode=rwc
BIND_ADDRESS=127.0.0.1:3002
NETWORK=testnet
MARKET_CONTRACT_ID=market7-260215a.testnet
EVENT_STANDARD=nest-markets
RUST_LOG=info
```

## Run

```bash
cargo run
```

## Verify

```bash
curl http://127.0.0.1:3002/health
curl "http://127.0.0.1:3002/markets/0/price-history?limit=200"
curl "http://127.0.0.1:3002/markets/0/trades?limit=50"
websocat "ws://127.0.0.1:3002/ws?market_id=0"
```
