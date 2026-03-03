'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, SlidersHorizontal } from 'lucide-react';

import { MarketCard } from '@/components/markets/market-card';
import { fetchMarkets } from '@/lib/markets';
import type { MarketStatus, MarketView } from '@/lib/types';

type StatusFilter = 'All' | Exclude<MarketStatus, 'Unknown'>;
type SortOption = 'newest' | 'collateral';

const statuses: StatusFilter[] = ['All', 'Open', 'Resolving', 'Disputed', 'Settled', 'Closed'];
const softEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

function SkeletonCard() {
  return (
    <div className="dk-card dk-card--skeleton">
      <div className="skel skel--badge" />
      <div className="skel skel--title" />
      <div className="skel skel--text" />
      <div className="skel skel--bar" />
      <div className="skel skel--footer">
        <div className="skel skel--tag" />
        <div className="skel skel--tag" />
      </div>
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: softEase },
  },
};

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
    return () => { mounted = false; };
  }, [wallet]);

  const visibleMarkets = useMemo(() => {
    const filtered = markets
      .filter((market) => statusFilter === 'All' || market.status === statusFilter)
      .filter((market) => market.question.toLowerCase().includes(search.toLowerCase()));

    return filtered.sort((a, b) => {
      if (sortBy === 'collateral') return Number(b.totalCollateral) - Number(a.totalCollateral);
      return b.id - a.id;
    });
  }, [markets, search, sortBy, statusFilter]);

  return (
    <section className="dk-page">
      {/* Header */}
      <motion.header
        className="dk-page__header"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: softEase }}
      >
        <h1 className="dk-page__title">Markets</h1>
        <p className="dk-page__subtitle">Browse active questions and trade outcome probabilities.</p>
      </motion.header>

      {/* Controls */}
      <motion.div
        className="dk-controls"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: softEase }}
      >
        {/* Search */}
        <div className="dk-search">
          <Search size={16} className="dk-search__icon" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets..."
            type="search"
            className="dk-search__input"
          />
        </div>

        {/* Status filter pills */}
        <div className="dk-pills">
          {statuses.map((status) => (
            <button
              key={status}
              className={`dk-pill ${statusFilter === status ? 'dk-pill--active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="dk-sort">
          <SlidersHorizontal size={14} />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="dk-sort__select">
            <option value="newest">Newest</option>
            <option value="collateral">Highest volume</option>
          </select>
        </div>
      </motion.div>

      {/* Loading skeletons */}
      {loading && (
        <div className="dk-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.div
              key={`skel-${i}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <SkeletonCard />
            </motion.div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && visibleMarkets.length === 0 && (
        <motion.p
          className="dk-empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          No markets found. {search && 'Try a different search term.'}
        </motion.p>
      )}

      {/* Market grid */}
      {!loading && visibleMarkets.length > 0 && (
        <motion.div
          className="dk-grid"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {visibleMarkets.map((market) => (
            <motion.div key={market.id} variants={cardVariants}>
              <MarketCard market={market} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </section>
  );
}
