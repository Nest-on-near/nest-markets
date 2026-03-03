'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useNearWallet } from 'near-connect-hooks';
import { motion } from 'framer-motion';
import { Wallet, TrendingUp, ArrowRight } from 'lucide-react';

import { PositionCard } from '@/components/markets/position-card';
import { fetchPortfolio } from '@/lib/markets';
import type { PositionView } from '@/lib/types';

function SkeletonPosition() {
  return (
    <div className="dk-card dk-card--skeleton">
      <div className="skel skel--title" />
      <div className="skel skel--text" />
      <div className="skel skel--bar" />
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

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
    return () => { mounted = false; };
  }, [wallet]);

  if (!wallet.signedAccountId) {
    return (
      <section className="dk-page">
        <motion.div
          className="dk-empty-state"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="dk-empty-state__icon">
            <Wallet size={32} />
          </div>
          <h2 className="dk-empty-state__title">Connect your wallet</h2>
          <p className="dk-empty-state__desc">View your positions and redeemable balances by connecting your NEAR wallet.</p>
        </motion.div>
      </section>
    );
  }

  return (
    <section className="dk-page">
      {/* Header */}
      <motion.header
        className="dk-page__header"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="dk-page__title">Portfolio</h1>
        <p className="dk-page__subtitle">Track your YES/NO balances and estimated position value.</p>
      </motion.header>

      {/* Summary card */}
      <motion.div
        className="dk-summary-card"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="dk-summary-card__item">
          <span className="dk-summary-card__label">Account</span>
          <span className="dk-summary-card__value dk-summary-card__value--accent">{wallet.signedAccountId}</span>
        </div>
        <div className="dk-summary-card__divider" />
        <div className="dk-summary-card__item">
          <span className="dk-summary-card__label">Active Positions</span>
          <span className="dk-summary-card__value">{loading ? '—' : positions.length}</span>
        </div>
        <div className="dk-summary-card__divider" />
        <div className="dk-summary-card__item">
          <span className="dk-summary-card__label">Status</span>
          <span className="dk-summary-card__value dk-summary-card__value--green">
            <TrendingUp size={14} /> Active
          </span>
        </div>
      </motion.div>

      {/* Loading */}
      {loading && (
        <motion.div
          className="dk-position-list"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <motion.div
              key={`skel-${i}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <SkeletonPosition />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Empty */}
      {!loading && positions.length === 0 && (
        <motion.div
          className="dk-empty-state"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="dk-empty-state__icon">
            <TrendingUp size={28} />
          </div>
          <h3 className="dk-empty-state__title">No positions yet</h3>
          <p className="dk-empty-state__desc">Start trading to see your positions here.</p>
          <Link href="/markets" className="dk-empty-state__link">
            Browse Markets <ArrowRight size={16} />
          </Link>
        </motion.div>
      )}

      {/* Positions */}
      {!loading && positions.length > 0 && (
        <motion.div
          className="dk-position-list"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {positions.map((position) => (
            <motion.div key={position.marketId} variants={itemVariants}>
              <PositionCard position={position} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </section>
  );
}
