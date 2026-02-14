import Link from 'next/link';

import { formatResolutionTime, formatUsd } from '@/lib/format';
import { getPrices } from '@/lib/markets';
import type { MarketView } from '@/lib/types';
import { ProbabilityBar } from '@/components/ui/probability-bar';
import { StatusBadge } from '@/components/ui/status-badge';

interface MarketCardProps {
  market: MarketView;
}

export function MarketCard({ market }: MarketCardProps) {
  const prices = getPrices(market);

  return (
    <article className="card market-card">
      <div className="market-card__meta">
        <StatusBadge status={market.status} />
        <span>Resolves {formatResolutionTime(market.resolutionTimeNs)}</span>
      </div>

      <h3>
        <Link href={`/markets/${market.id}`}>{market.question}</Link>
      </h3>
      <p>{market.description}</p>

      <ProbabilityBar yes={prices.yes} no={prices.no} />

      <div className="market-card__footer">
        <span>Collateral {formatUsd(Number(market.totalCollateral) / 1_000_000)}</span>
        <span>Fee {(market.feeBps / 100).toFixed(2)}%</span>
      </div>
    </article>
  );
}
