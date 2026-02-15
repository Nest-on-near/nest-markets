export const NETWORK_ID = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
export const NEST_UI_VOTE_URL = (process.env.NEXT_PUBLIC_NEST_UI_VOTE_URL ?? 'http://127.0.0.1:3000/app/vote').replace(/\/$/, '');

export const CONTRACTS = {
  market: process.env.NEXT_PUBLIC_MARKET_CONTRACT ?? 'market7-260215a.testnet',
  outcomeToken: process.env.NEXT_PUBLIC_OUTCOME_TOKEN_CONTRACT ?? 'outcome7-260215a.testnet',
  usdc: process.env.NEXT_PUBLIC_USDC_CONTRACT ?? 'nusd-1.testnet',
  oracle: process.env.NEXT_PUBLIC_ORACLE_CONTRACT ?? 'oracle7-260215a.testnet',
};

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10 ** USDC_DECIMALS;

export const DEFAULT_GAS = '100000000000000';
export const ONE_YOCTO = '1';

export const DEFAULT_SLIPPAGE = 1;

export const MARKET_FEE_BPS_DEFAULT = 200;
