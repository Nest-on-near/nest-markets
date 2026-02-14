import { CONTRACTS, DEFAULT_GAS, INDEXER_URL, MARKET_FEE_BPS_DEFAULT, ONE_YOCTO } from '@/config';
import { fromChainAmount, toChainAmount } from '@/lib/format';
import { mockMarkets } from '@/lib/mock-data';
import type { IndexedPricePoint, MarketStatus, MarketView, Outcome, PositionView } from '@/lib/types';

interface WalletLike {
  viewFunction: (args: { contractId: string; method: string; args?: Record<string, unknown> }) => Promise<unknown>;
  callFunction: (args: {
    contractId: string;
    method: string;
    args?: Record<string, unknown>;
    gas?: string;
    deposit?: string;
  }) => Promise<unknown>;
  signedAccountId: string;
}

function normalizeStatus(value: unknown): MarketStatus {
  const status = String(value ?? 'Unknown').toLowerCase();

  if (status.includes('open')) return 'Open';
  if (status.includes('close')) return 'Closed';
  if (status.includes('resolving')) return 'Resolving';
  if (status.includes('dispute')) return 'Disputed';
  if (status.includes('settled')) return 'Settled';
  return 'Unknown';
}

function normalizeOutcome(value: unknown): Outcome | null {
  if (value === null || value === undefined) return null;
  const outcome = String(value).toLowerCase();
  return outcome.includes('yes') ? 'Yes' : outcome.includes('no') ? 'No' : null;
}

function unwrapNearNumber(value: unknown, fallback = '0'): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (value && typeof value === 'object' && '0' in value) {
    const raw = (value as Record<string, unknown>)['0'];
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint') {
      return String(raw);
    }
  }

  return fallback;
}

function parseMarket(raw: Record<string, unknown>): MarketView {
  const id = Number(unwrapNearNumber(raw.id ?? raw.market_id, '0'));
  const yesReserve = unwrapNearNumber(raw.yes_reserve ?? raw.yesReserve, '0');
  const noReserve = unwrapNearNumber(raw.no_reserve ?? raw.noReserve, '0');
  const yesPrice = unwrapNearNumber(raw.yes_price, '500000');
  const noPrice = unwrapNearNumber(raw.no_price, '500000');
  const totalCollateral = unwrapNearNumber(raw.total_collateral, '0');

  return {
    id,
    question: String(raw.question ?? `Market #${id}`),
    description: String(raw.description ?? ''),
    resolutionTimeNs: unwrapNearNumber(raw.resolution_time_ns ?? raw.resolution_time, '0'),
    creator: String(raw.creator ?? ''),
    status: normalizeStatus(raw.status),
    outcome: normalizeOutcome(raw.outcome),
    yesReserve,
    noReserve,
    yesPrice,
    noPrice,
    totalCollateral,
    feeBps: Number(raw.fee_bps ?? MARKET_FEE_BPS_DEFAULT),
  };
}

export function getPrices(market: MarketView): { yes: number; no: number } {
  const yesFromContract = Number(market.yesPrice);
  const noFromContract = Number(market.noPrice);

  if (Number.isFinite(yesFromContract) && Number.isFinite(noFromContract) && yesFromContract >= 0 && noFromContract >= 0) {
    return {
      yes: yesFromContract / 10_000,
      no: noFromContract / 10_000,
    };
  }

  const yes = Number(market.yesReserve);
  const no = Number(market.noReserve);
  const total = yes + no;
  if (!Number.isFinite(total) || total <= 0) {
    return { yes: 50, no: 50 };
  }

  return {
    yes: (no / total) * 100,
    no: (yes / total) * 100,
  };
}

export async function fetchIndexedPriceHistory(marketId: number, limit = 200): Promise<IndexedPricePoint[]> {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  const response = await fetch(`${INDEXER_URL}/markets/${marketId}/price-history?limit=${safeLimit}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch indexed price history: ${response.status}`);
  }

  const payload = await response.json() as {
    market_id?: unknown;
    points?: Array<{
      block_height?: unknown;
      timestamp_ms?: unknown;
      yes?: unknown;
      no?: unknown;
      yes_raw?: unknown;
      no_raw?: unknown;
    }>;
  };

  if (!Array.isArray(payload.points)) {
    return [];
  }

  return payload.points.map((point) => ({
    blockHeight: Number(point.block_height ?? 0),
    timestampMs: Number(point.timestamp_ms ?? 0),
    yes: Number(point.yes ?? 0),
    no: Number(point.no ?? 0),
    yesRaw: String(point.yes_raw ?? '0'),
    noRaw: String(point.no_raw ?? '0'),
  }));
}

export function getIndexerWebSocketUrl(marketId: number): string {
  const base = INDEXER_URL.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}/ws${separator}market_id=${marketId}`;
}

export async function fetchMarkets(wallet: WalletLike): Promise<MarketView[]> {
  try {
    const countRaw = await wallet.viewFunction({
      contractId: CONTRACTS.market,
      method: 'get_market_count',
    });

    const count = Number(unwrapNearNumber(countRaw, '0'));

    if (!Number.isFinite(count) || count <= 0) {
      return [];
    }

    const marketPromises = Array.from({ length: count }, (_, index) => {
      return wallet.viewFunction({
        contractId: CONTRACTS.market,
        method: 'get_market',
        args: { market_id: index },
      });
    });

    const rawMarkets = await Promise.all(marketPromises);

    return rawMarkets
      .filter(Boolean)
      .map((market) => parseMarket(market as Record<string, unknown>));
  } catch {
    return mockMarkets;
  }
}

export async function fetchMarketById(wallet: WalletLike, marketId: number): Promise<MarketView | null> {
  try {
    const market = await wallet.viewFunction({
      contractId: CONTRACTS.market,
      method: 'get_market',
      args: { market_id: marketId },
    });

    if (!market || typeof market !== 'object') {
      return null;
    }

    return parseMarket(market as Record<string, unknown>);
  } catch {
    const markets = await fetchMarkets(wallet);
    return markets.find((m) => m.id === marketId) ?? null;
  }
}

export async function buyOutcome(wallet: WalletLike, params: {
  marketId: number;
  outcome: Outcome;
  collateralIn: number;
  minTokensOut: number;
}): Promise<void> {
  const amount = toChainAmount(params.collateralIn);
  const minOut = toChainAmount(params.minTokensOut);

  await wallet.callFunction({
    contractId: CONTRACTS.usdc,
    method: 'ft_transfer_call',
    gas: DEFAULT_GAS,
    deposit: ONE_YOCTO,
    args: {
      receiver_id: CONTRACTS.market,
      amount,
      msg: JSON.stringify({
        action: 'Buy',
        market_id: params.marketId,
        outcome: params.outcome,
        min_tokens_out: minOut,
      }),
    },
  });
}

export async function sellOutcome(wallet: WalletLike, params: {
  marketId: number;
  outcome: Outcome;
  tokensIn: number;
  minCollateralOut: number;
}): Promise<void> {
  await wallet.callFunction({
    contractId: CONTRACTS.market,
    method: 'sell',
    gas: DEFAULT_GAS,
    args: {
      market_id: params.marketId,
      outcome: params.outcome,
      tokens_in: toChainAmount(params.tokensIn),
      min_collateral_out: toChainAmount(params.minCollateralOut),
    },
  });
}

export async function createMarket(wallet: WalletLike, params: {
  question: string;
  description: string;
  resolutionTimeNs: string;
  initialLiquidity: number;
}): Promise<void> {
  await wallet.callFunction({
    contractId: CONTRACTS.usdc,
    method: 'ft_transfer_call',
    gas: DEFAULT_GAS,
    deposit: ONE_YOCTO,
    args: {
      receiver_id: CONTRACTS.market,
      amount: toChainAmount(params.initialLiquidity),
      msg: JSON.stringify({
        action: 'CreateMarket',
        question: params.question,
        description: params.description,
        resolution_time_ns: params.resolutionTimeNs,
      }),
    },
  });
}

export async function redeemWinningTokens(wallet: WalletLike, params: {
  marketId: number;
  amount: number;
}): Promise<void> {
  await wallet.callFunction({
    contractId: CONTRACTS.market,
    method: 'redeem_tokens',
    gas: DEFAULT_GAS,
    args: {
      market_id: params.marketId,
      amount: toChainAmount(params.amount),
    },
  });
}

export async function fetchCollateralBalance(wallet: WalletLike): Promise<number> {
  if (!wallet.signedAccountId) {
    return 0;
  }

  const raw = await wallet.viewFunction({
    contractId: CONTRACTS.usdc,
    method: 'ft_balance_of',
    args: {
      account_id: wallet.signedAccountId,
    },
  });

  return fromChainAmount(unwrapNearNumber(raw, '0'));
}

export async function fetchOutcomeBalance(wallet: WalletLike, marketId: number, outcome: Outcome): Promise<number> {
  if (!wallet.signedAccountId) {
    return 0;
  }

  const raw = await wallet.viewFunction({
    contractId: CONTRACTS.outcomeToken,
    method: 'balance_of',
    args: {
      market_id: marketId,
      outcome,
      account_id: wallet.signedAccountId,
    },
  });

  return fromChainAmount(unwrapNearNumber(raw, '0'));
}

export async function estimateBuyTokens(wallet: WalletLike, params: {
  marketId: number;
  outcome: Outcome;
  collateralIn: number;
}): Promise<number> {
  const result = await wallet.viewFunction({
    contractId: CONTRACTS.market,
    method: 'estimate_buy',
    args: {
      market_id: params.marketId,
      outcome: params.outcome,
      collateral_in: toChainAmount(params.collateralIn),
    },
  });

  return fromChainAmount(unwrapNearNumber(result, '0'));
}

export async function fetchPortfolio(wallet: WalletLike): Promise<PositionView[]> {
  if (!wallet.signedAccountId) {
    return [];
  }

  const markets = await fetchMarkets(wallet);

  const positions = await Promise.all(
    markets.map(async (market) => {
      const [yesBalance, noBalance] = await Promise.all([
        fetchOutcomeBalance(wallet, market.id, 'Yes'),
        fetchOutcomeBalance(wallet, market.id, 'No'),
      ]);

      const prices = getPrices(market);

      return {
        marketId: market.id,
        question: market.question,
        yesBalance: yesBalance.toFixed(2),
        noBalance: noBalance.toFixed(2),
        yesValue: yesBalance * (prices.yes / 100),
        noValue: noBalance * (prices.no / 100),
      } satisfies PositionView;
    }),
  );

  return positions.filter((position) => Number(position.yesBalance) > 0 || Number(position.noBalance) > 0);
}
