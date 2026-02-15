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
  fetchDisputeRequestIdHex,
  fetchMarketActivity,
  fetchMarketById,
  fetchResolutionStatus,
  getPrices,
  submitResolution,
} from '@/lib/markets';
import { NETWORK_ID, NEST_UI_VOTE_URL } from '@/config';
import type { MarketActivityItem, MarketView, Outcome, ResolutionStatusView } from '@/lib/types';

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
  const [resolutionBond, setResolutionBond] = useState('10');
  const [resolutionOutcome, setResolutionOutcome] = useState<Outcome>('Yes');
  const [disputeBond, setDisputeBond] = useState('10');
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
        const [status, timeline] = await Promise.all([
          fetchResolutionStatus(marketId),
          fetchMarketActivity(marketId, 100),
        ]);
        setResolutionStatus(status);
        setActivity(timeline);
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
        const [nextMarket, status, timeline] = await Promise.all([
          fetchMarketById(wallet, marketId),
          fetchResolutionStatus(marketId),
          fetchMarketActivity(marketId, 100),
        ]);
        setMarket(nextMarket);
        setResolutionStatus(status);
        setActivity(timeline);
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

  async function handleSubmitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!market) return;
    if (!wallet.signedAccountId) {
      setActionError('Connect wallet before submitting resolution.');
      return;
    }

    const bond = Number(resolutionBond);
    if (!Number.isFinite(bond) || bond <= 0) {
      setActionError('Resolution bond must be a positive number.');
      return;
    }

    setActionError('');
    setResolutionPending(true);
    try {
      await submitResolution(wallet, { marketId: market.id, outcome: resolutionOutcome, bondAmount: bond });
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

    const bond = Number(disputeBond);
    if (!Number.isFinite(bond) || bond <= 0) {
      setActionError('Dispute bond must be a positive number.');
      return;
    }

    setActionError('');
    setDisputePending(true);
    try {
      await disputeAssertion(wallet, { assertionIdHex: resolutionStatus.assertionId, bondAmount: bond });
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
            <p className="muted">Lifecycle status: {resolutionStatus?.status ?? market.status}</p>
            {disputeCountdown ? <p className="muted">Dispute window: {disputeCountdown}</p> : null}
            {resolutionStatus?.assertionId ? <p className="muted">Assertion ID: <code>{resolutionStatus.assertionId}</code></p> : null}
            {dvmRequestIdHex ? <p className="muted">DVM Request ID: <code>{dvmRequestIdHex}</code></p> : null}
            {!canSubmitResolution ? <p className="muted">Resolution unlocks at {formatResolutionTime(market.resolutionTimeNs)}.</p> : null}
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
              <label>
                Resolution Bond (USDC)
                <input
                  value={resolutionBond}
                  onChange={(event) => setResolutionBond(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!canSubmitResolution || resolutionPending}
                />
              </label>
              <button type="submit" className="cta-button" disabled={resolutionPending || !canSubmitResolution}>
                {resolutionPending ? 'Submitting...' : 'Submit Resolution'}
              </button>
            </form>

            <form onSubmit={handleDispute}>
              <label>
                Dispute Bond (USDC)
                <input value={disputeBond} onChange={(event) => setDisputeBond(event.target.value)} type="number" min="0" step="0.01" />
              </label>
              <button
                type="submit"
                className="cta-button"
                disabled={disputePending || !resolutionStatus?.assertionId || resolutionStatus.status.toLowerCase() !== 'resolving'}
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
            {activity.length === 0 ? <p className="muted">No lifecycle events yet.</p> : null}
            <ul>
              {activity.map((item) => (
                <li key={`${item.receiptId}-${item.eventType}`}>
                  <strong>{item.eventType}</strong> at block {item.blockHeight} ({new Date(item.timestampMs).toLocaleString()})
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </section>
  );
}
