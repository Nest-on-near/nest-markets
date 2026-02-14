'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';

import { MarketCard } from '@/components/markets/market-card';
import { fetchMarkets } from '@/lib/markets';
import type { MarketStatus, MarketView } from '@/lib/types';

type StatusFilter = 'All' | Exclude<MarketStatus, 'Unknown'>;

type SortOption = 'newest' | 'collateral';

export default function MarketsPage() {
  const wallet = useNearWallet();

  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const nextMarkets = await fetchMarkets(wallet);

      if (mounted) {
        setMarkets(nextMarkets);
        setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [wallet]);

  const visibleMarkets = useMemo(() => {
    const filtered = markets
      .filter((market) => statusFilter === 'All' || market.status === statusFilter)
      .filter((market) => market.question.toLowerCase().includes(search.toLowerCase()));

    return filtered.sort((a, b) => {
      if (sortBy === 'collateral') {
        return Number(b.totalCollateral) - Number(a.totalCollateral);
      }

      return b.id - a.id;
    });
  }, [markets, search, sortBy, statusFilter]);

  return (
    <section className="page-content">
      <header className="hero">
        <h1>Markets</h1>
        <p>Browse active questions and trade outcome probabilities in USDC.</p>
      </header>

      <section className="controls card">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search markets"
          type="search"
        />

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="All">All statuses</option>
          <option value="Open">Open</option>
          <option value="Resolving">Resolving</option>
          <option value="Disputed">Disputed</option>
          <option value="Settled">Settled</option>
          <option value="Closed">Closed</option>
        </select>

        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
          <option value="newest">Newest</option>
          <option value="collateral">Highest collateral</option>
        </select>
      </section>

      {loading ? <p className="muted">Loading markets...</p> : null}

      <section className="market-grid">
        {visibleMarkets.map((market) => (
          <MarketCard market={market} key={market.id} />
        ))}
      </section>
    </section>
  );
}
