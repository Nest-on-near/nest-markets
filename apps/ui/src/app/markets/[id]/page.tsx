'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, DollarSign, Percent, Shield, AlertTriangle, CheckCircle2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

import { PriceHistoryChart } from '@/components/markets/price-history-chart';
import { TradePanel } from '@/components/markets/trade-panel';
import { ProbabilityBar } from '@/components/ui/probability-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatResolutionTime, formatUsd } from '@/lib/format';
import {
  disputeAssertion,
  fetchAssertionBondAmount,
  fetchDisputeRequestIdHex,
  fetchMarketActivity,
  fetchMarketById,
  fetchMinimumBondAmount,
  fetchResolutionStatusWithFallback,
  getPrices,
  submitResolution,
} from '@/lib/markets';
import { ensureUsdcBalanceWithOnramp } from '@/lib/onramp';
import { NETWORK_ID, NEST_UI_VOTE_URL } from '@/config';
import type { MarketActivityItem, MarketView, Outcome, ResolutionStatusView } from '@/lib/types';

/* ── Helpers ── */

interface LifecycleEventView {
  key: string;
  eventType: string;
  blockHeight: number | null;
  timestampMs: number;
  source: 'indexer' | 'status';
  note?: string;
}

function formatHash(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

function normalizeEventType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function hasLifecycleEvent(events: LifecycleEventView[], aliases: string[]): boolean {
  const aliasSet = new Set(aliases.map((item) => normalizeEventType(item)));
  return events.some((event) => aliasSet.has(normalizeEventType(event.eventType)));
}

function toMsFromNs(value: string | null): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  return asNumber / 1_000_000;
}

function toTitleCaseEvent(value: string): string {
  return value
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/* ── Loading skeleton ── */
function DetailSkeleton() {
  return (
    <div className="dk-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem' }}>
        <div className="skel" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%' }} />
        <div className="skel" style={{ width: '8rem', height: '0.8rem' }} />
      </div>
      <div className="dk-detail-layout">
        <div className="dk-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="skel skel--badge" />
          <div className="skel skel--title" style={{ width: '90%' }} />
          <div className="skel skel--text" style={{ width: '70%' }} />
          <div className="skel skel--bar" style={{ height: '1.5rem', borderRadius: '100px' }} />
          <div className="skel" style={{ width: '100%', height: '160px', borderRadius: '0.7rem' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
            <div className="skel" style={{ height: '3rem', borderRadius: '0.5rem' }} />
            <div className="skel" style={{ height: '3rem', borderRadius: '0.5rem' }} />
            <div className="skel" style={{ height: '3rem', borderRadius: '0.5rem' }} />
          </div>
        </div>
        <div className="dk-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="skel" style={{ width: '50%', height: '2rem', borderRadius: '100px' }} />
          <div className="skel" style={{ width: '100%', height: '3rem', borderRadius: '0.7rem' }} />
          <div className="skel" style={{ width: '100%', height: '3rem', borderRadius: '0.7rem' }} />
          <div className="skel" style={{ width: '100%', height: '2.5rem', borderRadius: '100px' }} />
        </div>
      </div>
    </div>
  );
}

/* ── Animations ── */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

/* ── Main component ── */
export default function MarketDetailPage() {
  const wallet = useNearWallet();
  const params = useParams<{ id: string }>();
  const marketId = Number(params.id);

  const [market, setMarket] = useState<MarketView | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatusView | null>(null);
  const [activity, setActivity] = useState<MarketActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lifecycleError, setLifecycleError] = useState('');
  const [actionError, setActionError] = useState('');
  const [resolutionPending, setResolutionPending] = useState(false);
  const [disputePending, setDisputePending] = useState(false);
  const [resolutionBondAmount, setResolutionBondAmount] = useState<number | null>(null);
  const [resolutionOutcome, setResolutionOutcome] = useState<Outcome>('Yes');
  const [disputeBondAmount, setDisputeBondAmount] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [activePanel, setActivePanel] = useState<'Trade' | 'Resolution'>('Trade');
  const [dvmRequestIdHex, setDvmRequestIdHex] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  async function loadMarket() {
    setLoading(true);
    setLifecycleError('');
    const nextMarket = await fetchMarketById(wallet, marketId);
    setMarket(nextMarket);
    if (nextMarket) {
      try {
        const [status, timeline, minimumBond] = await Promise.all([
          fetchResolutionStatusWithFallback(wallet, marketId),
          fetchMarketActivity(marketId, 100),
          fetchMinimumBondAmount(wallet),
        ]);
        setResolutionStatus(status);
        setActivity(timeline);
        setResolutionBondAmount(minimumBond);
        if (status.assertionId) {
          try {
            const exactDisputeBond = await fetchAssertionBondAmount(wallet, status.assertionId);
            setDisputeBondAmount(exactDisputeBond);
          } catch {
            setDisputeBondAmount(minimumBond);
          }
        } else {
          setDisputeBondAmount(minimumBond);
        }
      } catch (error) {
        setLifecycleError(error instanceof Error ? error.message : 'Failed to load lifecycle data.');
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMarket();
  }, [wallet, marketId]);

  useEffect(() => {
    let cancelled = false;
    async function resolveRequestId() {
      if (!resolutionStatus?.assertionId) {
        setDvmRequestIdHex(null);
        return;
      }
      try {
        const requestId = await fetchDisputeRequestIdHex(wallet, resolutionStatus.assertionId);
        if (!cancelled) setDvmRequestIdHex(requestId);
      } catch {
        if (!cancelled) setDvmRequestIdHex(null);
      }
    }
    resolveRequestId();
    return () => { cancelled = true; };
  }, [wallet, resolutionStatus?.assertionId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!Number.isFinite(marketId)) return;
      try {
        const [nextMarket, status, timeline, minimumBond] = await Promise.all([
          fetchMarketById(wallet, marketId),
          fetchResolutionStatusWithFallback(wallet, marketId),
          fetchMarketActivity(marketId, 100),
          fetchMinimumBondAmount(wallet),
        ]);
        setMarket(nextMarket);
        setResolutionStatus(status);
        setActivity(timeline);
        setResolutionBondAmount(minimumBond);
        if (status.assertionId) {
          try {
            const exactDisputeBond = await fetchAssertionBondAmount(wallet, status.assertionId);
            setDisputeBondAmount(exactDisputeBond);
          } catch {
            setDisputeBondAmount(minimumBond);
          }
        } else {
          setDisputeBondAmount(minimumBond);
        }
      } catch {
        // Keep existing state
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [wallet, marketId]);

  /* ── Derived state ── */

  const eligibility = useMemo(() => {
    if (!market) return 'Unknown';
    const nowNs = BigInt(nowMs) * 1_000_000n;
    const resolutionNs = BigInt(market.resolutionTimeNs || '0');
    if (nowNs < resolutionNs) return 'Before resolution time';
    if (market.status === 'Resolving') return 'Resolving';
    if (market.status === 'Disputed') return 'Disputed';
    if (market.status === 'Settled') return 'Settled';
    return 'Ready';
  }, [market, nowMs]);

  const disputeCountdown = useMemo(() => {
    if (!resolutionStatus?.livenessDeadlineNs) return null;
    const endMs = Number(resolutionStatus.livenessDeadlineNs) / 1_000_000;
    if (!Number.isFinite(endMs)) return null;
    const delta = Math.max(0, Math.floor((endMs - nowMs) / 1000));
    const hours = Math.floor(delta / 3600);
    const minutes = Math.floor((delta % 3600) / 60);
    const seconds = delta % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }, [resolutionStatus, nowMs]);

  const canSubmitResolution = useMemo(() => {
    if (!market) return false;
    if (resolutionStatus?.isResolvableNow !== null && resolutionStatus?.isResolvableNow !== undefined) {
      return resolutionStatus.isResolvableNow;
    }
    const nowNs = BigInt(nowMs) * 1_000_000n;
    const resolutionNs = BigInt(market.resolutionTimeNs || '0');
    const isResolvableStatus = market.status === 'Open' || market.status === 'Closed';
    return nowNs >= resolutionNs && isResolvableStatus;
  }, [market, nowMs, resolutionStatus]);

  const voteHref = useMemo(() => {
    if (!resolutionStatus?.assertionId) return null;
    const p = new URLSearchParams({
      assertion_id: resolutionStatus.assertionId,
      market_id: String(marketId),
      network: NETWORK_ID,
    });
    if (dvmRequestIdHex) p.set('request_id', dvmRequestIdHex);
    return `${NEST_UI_VOTE_URL}?${p.toString()}`;
  }, [resolutionStatus?.assertionId, dvmRequestIdHex, marketId]);

  const lifecycleEvents = useMemo(() => {
    const base: LifecycleEventView[] = activity.map((item) => ({
      key: `${item.receiptId}-${item.eventType}`,
      eventType: item.eventType,
      blockHeight: item.blockHeight || null,
      timestampMs: item.timestampMs || 0,
      source: 'indexer',
    }));

    if (resolutionStatus) {
      const submittedMs = toMsFromNs(resolutionStatus.submittedTimestampNs);
      if (submittedMs !== null && !hasLifecycleEvent(base, ['resolution_submitted', 'assertion_made', 'assertion_submitted'])) {
        base.push({ key: `status-submitted-${submittedMs}`, eventType: 'resolution_submitted', blockHeight: resolutionStatus.submittedBlockHeight, timestampMs: submittedMs, source: 'status' });
      }
      const disputedMs = toMsFromNs(resolutionStatus.disputedTimestampNs);
      if (disputedMs !== null && !hasLifecycleEvent(base, ['resolution_disputed', 'assertion_disputed', 'disputed'])) {
        base.push({ key: `status-disputed-${disputedMs}`, eventType: 'resolution_disputed', blockHeight: resolutionStatus.disputedBlockHeight, timestampMs: disputedMs, source: 'status', note: resolutionStatus.disputer ? `Disputer: ${resolutionStatus.disputer}` : undefined });
      }
      const settledMs = toMsFromNs(resolutionStatus.settledTimestampNs);
      if (settledMs !== null && !hasLifecycleEvent(base, ['market_settled', 'resolution_settled', 'assertion_settled'])) {
        base.push({ key: `status-settled-${settledMs}`, eventType: 'resolution_settled', blockHeight: resolutionStatus.settledBlockHeight, timestampMs: settledMs, source: 'status' });
      }
    }

    return base.sort((a, b) => b.timestampMs - a.timestampMs);
  }, [activity, resolutionStatus]);

  /* ── Handlers ── */

  async function handleSubmitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!market) return;
    if (!wallet.signedAccountId) { setActionError('Connect wallet before submitting resolution.'); return; }
    if (resolutionBondAmount === null || resolutionBondAmount <= 0) { setActionError('Required resolution bond is unavailable.'); return; }
    setActionError('');
    setResolutionPending(true);
    try {
      await ensureUsdcBalanceWithOnramp(wallet, resolutionBondAmount);
      await submitResolution(wallet, { marketId: market.id, outcome: resolutionOutcome, bondAmount: resolutionBondAmount });
      await loadMarket();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Resolution transaction failed.');
    } finally { setResolutionPending(false); }
  }

  async function handleDispute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.signedAccountId) { setActionError('Connect wallet before disputing.'); return; }
    if (!resolutionStatus?.assertionId) { setActionError('No active assertion available to dispute.'); return; }
    if (disputeBondAmount === null || disputeBondAmount <= 0) { setActionError('Required dispute bond is unavailable.'); return; }
    setActionError('');
    setDisputePending(true);
    try {
      await ensureUsdcBalanceWithOnramp(wallet, disputeBondAmount);
      await disputeAssertion(wallet, { assertionIdHex: resolutionStatus.assertionId, bondAmount: disputeBondAmount });
      await loadMarket();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Dispute transaction failed.');
    } finally { setDisputePending(false); }
  }

  /* ── Loading state ── */
  if (loading) return <DetailSkeleton />;

  /* ── Not found ── */
  if (!market) {
    return (
      <div className="dk-page">
        <div className="dk-empty-state">
          <div className="dk-empty-state__icon"><AlertTriangle size={24} /></div>
          <h2 className="dk-empty-state__title">Market Not Found</h2>
          <p className="dk-empty-state__desc">Unable to load market #{marketId}.</p>
          <Link href="/markets" className="dk-empty-state__link">← Back to Markets</Link>
        </div>
      </div>
    );
  }

  const prices = getPrices(market);

  return (
    <motion.div className="dk-page" initial="hidden" animate="visible" variants={stagger}>

      {/* ── Breadcrumb ── */}
      <motion.div variants={fadeUp} className="dk-detail-back">
        <Link href="/markets" className="dk-detail-back__link">
          <ArrowLeft size={16} /> Back to Markets
        </Link>
      </motion.div>

      {/* ── Two-column layout ── */}
      <div className="dk-detail-layout">

        {/* ── Left column: Market info ── */}
        <motion.article variants={fadeUp} className="dk-card dk-detail-main">
          <div className="dk-card__meta">
            <StatusBadge status={market.status} />
            <span className="dk-card__resolve">by {market.creator}</span>
          </div>

          <h1 className="dk-detail-question">{market.question}</h1>
          {market.description && <p className="dk-detail-desc">{market.description}</p>}

          <ProbabilityBar yes={prices.yes} no={prices.no} />
          <PriceHistoryChart marketId={market.id} yes={prices.yes} no={prices.no} />

          {/* Stats grid */}
          <div className="dk-detail-stats">
            <div className="dk-detail-stat">
              <Clock size={14} className="dk-detail-stat__icon" />
              <div>
                <span className="dk-detail-stat__label">Resolution</span>
                <span className="dk-detail-stat__value">{formatResolutionTime(market.resolutionTimeNs)}</span>
              </div>
            </div>
            <div className="dk-detail-stat">
              <DollarSign size={14} className="dk-detail-stat__icon" />
              <div>
                <span className="dk-detail-stat__label">Collateral</span>
                <span className="dk-detail-stat__value">{formatUsd(Number(market.totalCollateral) / 1_000_000)}</span>
              </div>
            </div>
            <div className="dk-detail-stat">
              <Percent size={14} className="dk-detail-stat__icon" />
              <div>
                <span className="dk-detail-stat__label">Fee</span>
                <span className="dk-detail-stat__value">{(market.feeBps / 100).toFixed(2)}%</span>
              </div>
            </div>
            <div className="dk-detail-stat">
              <Shield size={14} className="dk-detail-stat__icon" />
              <div>
                <span className="dk-detail-stat__label">Eligibility</span>
                <span className="dk-detail-stat__value">{eligibility}</span>
              </div>
            </div>
          </div>
        </motion.article>

        {/* ── Right column: Trade / Resolution ── */}
        <motion.div variants={fadeUp} className="dk-detail-side">
          {/* Tab switcher */}
          <div className="dk-tabs">
            <button
              className={`dk-tab ${activePanel === 'Trade' ? 'dk-tab--active' : ''}`}
              onClick={() => setActivePanel('Trade')}
              type="button"
            >Trade</button>
            <button
              className={`dk-tab ${activePanel === 'Resolution' ? 'dk-tab--active' : ''}`}
              onClick={() => setActivePanel('Resolution')}
              type="button"
            >Resolution</button>
          </div>

          <AnimatePresence mode="wait">
            {activePanel === 'Trade' ? (
              <motion.div
                key="trade"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
              >
                <TradePanel
                  wallet={wallet}
                  marketId={market.id}
                  yesPrice={prices.yes}
                  noPrice={prices.no}
                  marketStatus={market.status}
                  settledOutcome={market.outcome}
                  onTradeComplete={loadMarket}
                />
              </motion.div>
            ) : (
              <motion.div
                key="resolution"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
                className="dk-card"
              >
                <h3 className="dk-detail-section-title">Resolution & Dispute</h3>

                {/* Status info */}
                <div className="dk-detail-meta-grid">
                  <div className="dk-detail-meta-item">
                    <span className="dk-detail-meta-label">Lifecycle</span>
                    <span className="dk-detail-meta-value">{resolutionStatus?.status ?? market.status}</span>
                  </div>
                  {disputeCountdown && (
                    <div className="dk-detail-meta-item">
                      <span className="dk-detail-meta-label">Dispute window</span>
                      <span className="dk-detail-meta-value dk-detail-meta-value--warn">{disputeCountdown}</span>
                    </div>
                  )}
                  {resolutionStatus?.assertionId && (
                    <div className="dk-detail-meta-item">
                      <span className="dk-detail-meta-label">Assertion</span>
                      <code className="dk-hash" title={resolutionStatus.assertionId}>{formatHash(resolutionStatus.assertionId)}</code>
                    </div>
                  )}
                  {dvmRequestIdHex && (
                    <div className="dk-detail-meta-item">
                      <span className="dk-detail-meta-label">DVM Request</span>
                      <code className="dk-hash" title={dvmRequestIdHex}>{formatHash(dvmRequestIdHex)}</code>
                    </div>
                  )}
                </div>

                {lifecycleError && <p className="dk-error">{lifecycleError}</p>}
                {actionError && <p className="dk-error">{actionError}</p>}

                {/* Submit resolution */}
                <form onSubmit={handleSubmitResolution} className="dk-form-group">
                  <label className="dk-label">Resolution Outcome</label>
                  <select
                    className="dk-input"
                    value={resolutionOutcome}
                    onChange={(e) => setResolutionOutcome(e.target.value as Outcome)}
                    disabled={!canSubmitResolution || resolutionPending}
                  >
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                  <p className="dk-form-hint">
                    Bond: {resolutionBondAmount === null ? 'Loading...' : `${formatUsd(resolutionBondAmount)} USDC`}
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="dk-btn dk-btn--primary"
                    disabled={resolutionPending || !canSubmitResolution || resolutionBondAmount === null}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {resolutionPending ? <><span className="dk-spinner" /> Submitting...</> : 'Submit Resolution'}
                  </motion.button>
                </form>

                {/* Dispute */}
                <form onSubmit={handleDispute} className="dk-form-group">
                  <p className="dk-form-hint">
                    Dispute bond: {disputeBondAmount === null ? 'Loading...' : `${formatUsd(disputeBondAmount)} USDC`}
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="dk-btn dk-btn--ghost"
                    disabled={disputePending || !resolutionStatus?.assertionId || resolutionStatus.status.toLowerCase() !== 'resolving' || disputeBondAmount === null}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {disputePending ? <><span className="dk-spinner" /> Submitting...</> : 'Dispute Assertion'}
                  </motion.button>
                </form>

                {voteHref && (
                  <a className="dk-btn dk-btn--primary" href={voteHref} target="_blank" rel="noreferrer" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
                    <ExternalLink size={14} /> Open in Nest Voting
                  </a>
                )}

                {/* Timeline accordion */}
                <button
                  className="dk-timeline-toggle"
                  onClick={() => setTimelineOpen(!timelineOpen)}
                  type="button"
                >
                  Lifecycle Timeline ({lifecycleEvents.length})
                  {timelineOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                <AnimatePresence>
                  {timelineOpen && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="dk-timeline"
                    >
                      {lifecycleEvents.length === 0 && <li className="dk-timeline__empty">No events yet.</li>}
                      {lifecycleEvents.map((item) => (
                        <li key={item.key} className="dk-timeline__item">
                          <div className="dk-timeline__dot" />
                          <div>
                            <strong>{toTitleCaseEvent(item.eventType)}</strong>
                            {item.blockHeight ? <span className="dk-timeline__block"> Block {item.blockHeight}</span> : null}
                            <span className="dk-timeline__time">{new Date(item.timestampMs).toLocaleString()}</span>
                            {item.note && <span className="dk-timeline__note">{item.note}</span>}
                          </div>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}
