'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useNearWallet } from 'near-connect-hooks';

import { PositionCard } from '@/components/markets/position-card';
import { fetchPortfolio } from '@/lib/markets';
import type { PositionView } from '@/lib/types';

export default function PortfolioPage() {
  const wallet = useNearWallet();

  const [positions, setPositions] = useState<PositionView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      const nextPositions = await fetchPortfolio(wallet);

      if (mounted) {
        setPositions(nextPositions);
        setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [wallet]);

  if (!wallet.signedAccountId) {
    return (
      <section className="page-content">
        <h1>Portfolio</h1>
        <p className="muted">Connect your wallet to view positions and redeemable balances.</p>
      </section>
    );
  }

  return (
    <section className="page-content">
      <header className="hero">
        <h1>Portfolio</h1>
        <p>Track your YES/NO balances and estimated position value.</p>
      </header>

      {loading ? <p className="muted">Loading positions...</p> : null}

      {!loading && positions.length === 0 ? (
        <p className="muted">
          No positions found yet. Browse <Link href="/">open markets</Link> to start trading.
        </p>
      ) : null}

      <section className="position-list">
        {positions.map((position) => (
          <PositionCard key={position.marketId} position={position} />
        ))}
      </section>
    </section>
  );
}
