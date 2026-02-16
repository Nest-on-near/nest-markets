export const NETWORK_ID = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
export const ENABLE_ONRAMP_ON_TESTNET = process.env.NEXT_PUBLIC_ENABLE_ONRAMP_ON_TESTNET === '1';
export const PINGPAY_POPUP_URL = process.env.NEXT_PUBLIC_PINGPAY_POPUP_URL;
export const PINGPAY_USDC_ASSET_ID = process.env.NEXT_PUBLIC_PINGPAY_USDC_ASSET_ID
  ?? 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
export const NEST_UI_VOTE_URL = (process.env.NEXT_PUBLIC_NEST_UI_VOTE_URL ?? 'http://127.0.0.1:3000/app/vote').replace(/\/$/, '');

export const CONTRACTS = {
  market: process.env.NEXT_PUBLIC_MARKET_CONTRACT ?? 'nest-markets-2.testnet',
  outcomeToken: process.env.NEXT_PUBLIC_OUTCOME_TOKEN_CONTRACT ?? 'nest-outcome-token-1.testnet',
  usdc: process.env.NEXT_PUBLIC_USDC_CONTRACT ?? 'nusd-1.testnet',
  oracle: process.env.NEXT_PUBLIC_ORACLE_CONTRACT ?? 'nest-oracle-6.testnet',
};

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10 ** USDC_DECIMALS;

export const DEFAULT_GAS = '100000000000000';
export const ONE_YOCTO = '1';

export const DEFAULT_SLIPPAGE = 1;

export const MARKET_FEE_BPS_DEFAULT = 200;
