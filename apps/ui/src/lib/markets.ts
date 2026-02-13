import { CONTRACTS, DEFAULT_GAS, MARKET_FEE_BPS_DEFAULT, ONE_YOCTO } from '@/config';
import { fromChainAmount, toChainAmount } from '@/lib/format';
import { mockMarkets } from '@/lib/mock-data';
import type { MarketStatus, MarketView, Outcome, PositionView } from '@/lib/types';

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

function parseMarket(raw: Record<string, unknown>): MarketView {
  const id = Number(raw.id ?? raw.market_id ?? 0);

  return {
    id,
    question: String(raw.question ?? `Market #${id}`),
    description: String(raw.description ?? ''),
    resolutionTimeNs: String(raw.resolution_time_ns ?? raw.resolution_time ?? '0'),
    creator: String(raw.creator ?? ''),
    status: normalizeStatus(raw.status),
    outcome: normalizeOutcome(raw.outcome),
    yesReserve: String(raw.yes_reserve ?? raw.yesReserve ?? '0'),
    noReserve: String(raw.no_reserve ?? raw.noReserve ?? '0'),
    volume: String(raw.volume ?? '0'),
    feeBps: Number(raw.fee_bps ?? MARKET_FEE_BPS_DEFAULT),
  };
}

export function getPrices(market: MarketView): { yes: number; no: number } {
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

export async function fetchMarkets(wallet: WalletLike): Promise<MarketView[]> {
  try {
    const allMarkets = await wallet.viewFunction({
      contractId: CONTRACTS.market,
      method: 'get_all_markets',
    });

    if (Array.isArray(allMarkets)) {
      return allMarkets.map((market) => parseMarket(market as Record<string, unknown>));
    }

    throw new Error('get_all_markets returned non-array');
  } catch {
    try {
      const countRaw = await wallet.viewFunction({
        contractId: CONTRACTS.market,
        method: 'get_market_count',
      });

      const count = Number(countRaw ?? 0);

      if (!Number.isFinite(count) || count <= 0) {
        return mockMarkets;
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
}

export async function fetchMarketById(wallet: WalletLike, marketId: number): Promise<MarketView | null> {
  const markets = await fetchMarkets(wallet);
  return markets.find((market) => market.id === marketId) ?? null;
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

async function fetchOutcomeBalance(wallet: WalletLike, marketId: number, outcome: Outcome): Promise<number> {
  const raw = await wallet.viewFunction({
    contractId: CONTRACTS.outcomeToken,
    method: 'balance_of',
    args: {
      market_id: marketId,
      outcome,
      account_id: wallet.signedAccountId,
    },
  });

  return fromChainAmount(String(raw ?? '0'));
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
