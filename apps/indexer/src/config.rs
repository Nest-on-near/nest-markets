#[derive(Clone)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_address: String,
    pub is_testnet: bool,
    pub market_contract_id: String,
    pub event_standard: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let database_url =
            std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:nest-market-indexer.db?mode=rwc".to_string());
        let bind_address = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3002".to_string());
        let market_contract_id =
            std::env::var("MARKET_CONTRACT_ID")
                .unwrap_or_else(|_| "nest-markets-2.testnet".to_string());
        let event_standard = std::env::var("EVENT_STANDARD").unwrap_or_else(|_| "nest-markets".to_string());
        let is_testnet = std::env::var("NETWORK")
            .map(|n| n == "testnet")
            .unwrap_or(true);

        Self {
            database_url,
            bind_address,
            is_testnet,
            market_contract_id,
            event_standard,
        }
    }
}
