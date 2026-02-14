'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';

import { PriceHistoryChart } from '@/components/markets/price-history-chart';
import { TradePanel } from '@/components/markets/trade-panel';
import { ProbabilityBar } from '@/components/ui/probability-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatResolutionTime, formatUsd } from '@/lib/format';
import { fetchMarketById, getPrices } from '@/lib/markets';
import type { MarketView } from '@/lib/types';

export default function MarketDetailPage() {
  const wallet = useNearWallet();
  const params = useParams<{ id: string }>();
  const marketId = Number(params.id);

  const [market, setMarket] = useState<MarketView | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMarket() {
    setLoading(true);
    const nextMarket = await fetchMarketById(wallet, marketId);
    setMarket(nextMarket);
    setLoading(false);
  }

  useEffect(() => {
    loadMarket();
  }, [wallet, marketId]);

  if (loading) {
    return <p className="muted">Loading market...</p>;
  }

  if (!market) {
    return (
      <section className="page-content">
        <h1>Market Not Found</h1>
        <p className="muted">Unable to load market #{marketId}.</p>
        <Link href="/">Back to markets</Link>
      </section>
    );
  }

  const prices = getPrices(market);

  return (
    <section className="page-content detail-layout">
      <article className="card market-detail">
        <div className="market-card__meta">
          <StatusBadge status={market.status} />
          <span>Creator {market.creator}</span>
        </div>

        <h1>{market.question}</h1>
        <p>{market.description}</p>

        <ProbabilityBar yes={prices.yes} no={prices.no} />
        <PriceHistoryChart marketId={market.id} yes={prices.yes} no={prices.no} />

        <div className="detail-stats">
          <div>
            <span className="muted">Resolution Time</span>
            <strong>{formatResolutionTime(market.resolutionTimeNs)}</strong>
          </div>
          <div>
            <span className="muted">Collateral</span>
            <strong>{formatUsd(Number(market.totalCollateral) / 1_000_000)}</strong>
          </div>
          <div>
            <span className="muted">Fee</span>
            <strong>{(market.feeBps / 100).toFixed(2)}%</strong>
          </div>
        </div>
      </article>

      <TradePanel wallet={wallet} marketId={market.id} yesPrice={prices.yes} noPrice={prices.no} onTradeComplete={loadMarket} />
    </section>
  );
}
