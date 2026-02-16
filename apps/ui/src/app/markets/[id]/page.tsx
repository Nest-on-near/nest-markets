'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';

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
        if (!cancelled) {
          setDvmRequestIdHex(requestId);
        }
      } catch {
        if (!cancelled) {
          setDvmRequestIdHex(null);
        }
      }
    }

    resolveRequestId();
    return () => {
      cancelled = true;
    };
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
        // Keep existing state; transient indexer/network issues should not wipe UI.
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [wallet, marketId]);

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
    if (!resolutionStatus?.livenessDeadlineNs) {
      return null;
    }
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
    if (!resolutionStatus?.assertionId) {
      return null;
    }
    const params = new URLSearchParams({
      assertion_id: resolutionStatus.assertionId,
      market_id: String(marketId),
      network: NETWORK_ID,
    });
    if (dvmRequestIdHex) {
      params.set('request_id', dvmRequestIdHex);
    }
    return `${NEST_UI_VOTE_URL}?${params.toString()}`;
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
      if (
        submittedMs !== null
        && !hasLifecycleEvent(base, ['resolution_submitted', 'assertion_made', 'assertion_submitted'])
      ) {
        base.push({
          key: `status-submitted-${submittedMs}`,
          eventType: 'resolution_submitted',
          blockHeight: resolutionStatus.submittedBlockHeight,
          timestampMs: submittedMs,
          source: 'status',
        });
      }

      const disputedMs = toMsFromNs(resolutionStatus.disputedTimestampNs);
      if (
        disputedMs !== null
        && !hasLifecycleEvent(base, ['resolution_disputed', 'assertion_disputed', 'disputed'])
      ) {
        base.push({
          key: `status-disputed-${disputedMs}`,
          eventType: 'resolution_disputed',
          blockHeight: resolutionStatus.disputedBlockHeight,
          timestampMs: disputedMs,
          source: 'status',
          note: resolutionStatus.disputer ? `Disputer: ${resolutionStatus.disputer}` : undefined,
        });
      }

      const settledMs = toMsFromNs(resolutionStatus.settledTimestampNs);
      if (
        settledMs !== null
        && !hasLifecycleEvent(base, ['market_settled', 'resolution_settled', 'assertion_settled'])
      ) {
        base.push({
          key: `status-settled-${settledMs}`,
          eventType: 'resolution_settled',
          blockHeight: resolutionStatus.settledBlockHeight,
          timestampMs: settledMs,
          source: 'status',
        });
      }
    }

    return base.sort((a, b) => b.timestampMs - a.timestampMs);
  }, [activity, resolutionStatus]);

  async function handleSubmitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!market) return;
    if (!wallet.signedAccountId) {
      setActionError('Connect wallet before submitting resolution.');
      return;
    }

    if (resolutionBondAmount === null || resolutionBondAmount <= 0) {
      setActionError('Required resolution bond is unavailable.');
      return;
    }

    setActionError('');
    setResolutionPending(true);
    try {
      await ensureUsdcBalanceWithOnramp(wallet, resolutionBondAmount);

      await submitResolution(wallet, {
        marketId: market.id,
        outcome: resolutionOutcome,
        bondAmount: resolutionBondAmount,
      });
      await loadMarket();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Resolution transaction failed.');
    } finally {
      setResolutionPending(false);
    }
  }

  async function handleDispute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.signedAccountId) {
      setActionError('Connect wallet before disputing.');
      return;
    }
    if (!resolutionStatus?.assertionId) {
      setActionError('No active assertion available to dispute.');
      return;
    }

    if (disputeBondAmount === null || disputeBondAmount <= 0) {
      setActionError('Required dispute bond is unavailable.');
      return;
    }

    setActionError('');
    setDisputePending(true);
    try {
      await ensureUsdcBalanceWithOnramp(wallet, disputeBondAmount);

      await disputeAssertion(wallet, {
        assertionIdHex: resolutionStatus.assertionId,
        bondAmount: disputeBondAmount,
      });
      await loadMarket();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Dispute transaction failed.');
    } finally {
      setDisputePending(false);
    }
  }

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
          <div>
            <span className="muted">Eligibility</span>
            <strong>{eligibility}</strong>
          </div>
        </div>
      </article>

      <div className="detail-side">
        <section className="card">
          <div className="segmented">
            <button className={activePanel === 'Trade' ? 'active' : ''} onClick={() => setActivePanel('Trade')} type="button">
              Trade
            </button>
            <button className={activePanel === 'Resolution' ? 'active' : ''} onClick={() => setActivePanel('Resolution')} type="button">
              Resolution & Dispute
            </button>
          </div>
        </section>

        {activePanel === 'Trade' ? (
          <TradePanel
            wallet={wallet}
            marketId={market.id}
            yesPrice={prices.yes}
            noPrice={prices.no}
            marketStatus={market.status}
            settledOutcome={market.outcome}
            onTradeComplete={loadMarket}
          />
        ) : (
          <article className="card market-detail">
            <h2>Resolution & Dispute</h2>
            <div className="resolution-meta">
              <p className="muted"><strong>Lifecycle status:</strong> {resolutionStatus?.status ?? market.status}</p>
              {disputeCountdown ? <p className="muted"><strong>Dispute window:</strong> {disputeCountdown}</p> : null}
              {resolutionStatus?.disputer ? <p className="muted"><strong>Disputer:</strong> {resolutionStatus.disputer}</p> : null}
              {resolutionStatus?.assertionId ? (
                <p className="muted">
                  <strong>Assertion ID:</strong>{' '}
                  <code className="hash-inline" title={resolutionStatus.assertionId}>{formatHash(resolutionStatus.assertionId)}</code>
                </p>
              ) : null}
              {dvmRequestIdHex ? (
                <p className="muted">
                  <strong>DVM Request ID:</strong>{' '}
                  <code className="hash-inline" title={dvmRequestIdHex}>{formatHash(dvmRequestIdHex)}</code>
                </p>
              ) : null}
              {!canSubmitResolution ? <p className="muted">Resolution unlocks at {formatResolutionTime(market.resolutionTimeNs)}.</p> : null}
            </div>
            {lifecycleError ? <p className="error-text">Lifecycle data unavailable: {lifecycleError}</p> : null}
            {actionError ? <p className="error-text">{actionError}</p> : null}

            <form onSubmit={handleSubmitResolution}>
              <label>
                Resolution Outcome
                <select
                  value={resolutionOutcome}
                  onChange={(event) => setResolutionOutcome(event.target.value as Outcome)}
                  disabled={!canSubmitResolution || resolutionPending}
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
              <p className="muted">
                Required bond: {resolutionBondAmount === null ? 'Loading...' : `${formatUsd(resolutionBondAmount)} USDC`}
              </p>
              <button
                type="submit"
                className="cta-button"
                disabled={resolutionPending || !canSubmitResolution || resolutionBondAmount === null}
              >
                {resolutionPending ? 'Submitting...' : 'Submit Resolution'}
              </button>
            </form>

            <form onSubmit={handleDispute}>
              <p className="muted">
                Required dispute bond: {disputeBondAmount === null ? 'Loading...' : `${formatUsd(disputeBondAmount)} USDC`}
              </p>
              <button
                type="submit"
                className="cta-button"
                disabled={
                  disputePending
                  || !resolutionStatus?.assertionId
                  || resolutionStatus.status.toLowerCase() !== 'resolving'
                  || disputeBondAmount === null
                }
              >
                {disputePending ? 'Submitting...' : 'Dispute Assertion'}
              </button>
            </form>

            {voteHref ? (
              <a className="cta-button" href={voteHref} target="_blank" rel="noreferrer">
                Open In Nest UI Voting
              </a>
            ) : null}

            <h3>Lifecycle Timeline</h3>
            {lifecycleEvents.length === 0 ? <p className="muted">No lifecycle events yet.</p> : null}
            <ul className="lifecycle-events">
              {lifecycleEvents.map((item) => (
                <li key={item.key}>
                  <strong>{toTitleCaseEvent(item.eventType)}</strong>
                  {item.blockHeight ? ` at block ${item.blockHeight}` : ''}
                  {' '}
                  ({new Date(item.timestampMs).toLocaleString()})
                  {item.note ? ` - ${item.note}` : ''}
                  {item.source === 'status' ? ' [from status]' : ''}
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </section>
  );
}
