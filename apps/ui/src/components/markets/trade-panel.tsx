'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SLIPPAGE, NETWORK_ID } from '@/config';
import {
  buyOutcome,
  estimateBuyTokens,
  fetchCollateralBalance,
  fetchOutcomeBalance,
  redeemWinningTokens,
  sellOutcome,
} from '@/lib/markets';
import { ensureUsdcBalanceWithOnramp, openUsdcOnramp, shouldRunMainnetOnrampGate } from '@/lib/onramp';
import type { MarketStatus, Outcome } from '@/lib/types';

interface WalletLike {
  callFunction: (args: {
    contractId: string;
    method: string;
    args?: Record<string, unknown>;
    gas?: string;
    deposit?: string;
  }) => Promise<unknown>;
  viewFunction: (args: { contractId: string; method: string; args?: Record<string, unknown> }) => Promise<unknown>;
  signedAccountId: string;
}

interface TradePanelProps {
  wallet: WalletLike;
  marketId: number;
  yesPrice: number;
  noPrice: number;
  marketStatus: MarketStatus;
  settledOutcome: Outcome | null;
  onTradeComplete: () => Promise<void>;
}

export function TradePanel({
  wallet,
  marketId,
  yesPrice,
  noPrice,
  marketStatus,
  settledOutcome,
  onTradeComplete,
}: TradePanelProps) {
  const [mode, setMode] = useState<'Buy' | 'Sell'>('Buy');
  const [outcome, setOutcome] = useState<Outcome>('Yes');
  const [amount, setAmount] = useState('10');
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE));
  const [pending, setPending] = useState(false);
  const [topUpPending, setTopUpPending] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [collateralBalance, setCollateralBalance] = useState(0);
  const [yesBalance, setYesBalance] = useState(0);
  const [noBalance, setNoBalance] = useState(0);
  const [error, setError] = useState('');
  const isOpen = marketStatus === 'Open';
  const isClosed = marketStatus === 'Closed';
  const isSettled = marketStatus === 'Settled';
  const showRedeemPanel = isSettled || isClosed;
  const redeemOutcome = settledOutcome;

  const selectedPrice = outcome === 'Yes' ? yesPrice : noPrice;
  const oppositePrice = outcome === 'Yes' ? noPrice : yesPrice;

  const localEstimate = useMemo(() => {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0 || selectedPrice <= 0) {
      return 0;
    }

    return mode === 'Buy' ? value / (selectedPrice / 100) : value * (selectedPrice / 100);
  }, [amount, mode, selectedPrice]);
  const [estimate, setEstimate] = useState(0);
  const availableAmount = isSettled
    ? redeemOutcome === 'Yes'
      ? yesBalance
      : redeemOutcome === 'No'
        ? noBalance
        : 0
    : isClosed
      ? 0
    : mode === 'Buy'
      ? collateralBalance
      : outcome === 'Yes'
        ? yesBalance
        : noBalance;

  const amountNumber = Number(amount);
  const hasValidAmount = Number.isFinite(amountNumber) && amountNumber > 0;
  const onrampAvailable = shouldRunMainnetOnrampGate();
  const shouldPromptMainnetBuyOnramp = isOpen
    && mode === 'Buy'
    && NETWORK_ID === 'mainnet'
    && onrampAvailable
    && hasValidAmount
    && amountNumber > collateralBalance;

  const averageFillPrice = useMemo(() => {
    if (!hasValidAmount || mode !== 'Buy' || !isOpen || estimate <= 0) {
      return 0;
    }

    return amountNumber / estimate;
  }, [amountNumber, estimate, hasValidAmount, isOpen, mode]);

  const maxPayoutIfCorrect = useMemo(() => {
    if (mode !== 'Buy' || !isOpen || estimate <= 0) {
      return 0;
    }

    return estimate;
  }, [estimate, isOpen, mode]);

  async function loadBalances() {
    if (!wallet.signedAccountId) {
      setCollateralBalance(0);
      setYesBalance(0);
      setNoBalance(0);
      return;
    }

    setBalancesLoading(true);
    try {
      const [nextCollateral, nextYes, nextNo] = await Promise.all([
        fetchCollateralBalance(wallet),
        fetchOutcomeBalance(wallet, marketId, 'Yes'),
        fetchOutcomeBalance(wallet, marketId, 'No'),
      ]);
      setCollateralBalance(nextCollateral);
      setYesBalance(nextYes);
      setNoBalance(nextNo);
    } finally {
      setBalancesLoading(false);
    }
  }

  useEffect(() => {
    if (showRedeemPanel) {
      const redeemValue = Number(amount);
      setEstimate(isSettled && Number.isFinite(redeemValue) && redeemValue > 0 ? redeemValue : 0);
      return;
    }

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setEstimate(0);
      return;
    }

    if (mode === 'Sell') {
      setEstimate(localEstimate);
      return;
    }

    let cancelled = false;
    setEstimating(true);

    estimateBuyTokens(wallet, { marketId, outcome, collateralIn: value })
      .then((nextEstimate) => {
        if (!cancelled) {
          setEstimate(nextEstimate);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEstimate(localEstimate);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setEstimating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [amount, isSettled, localEstimate, marketId, mode, outcome, showRedeemPanel, wallet]);

  useEffect(() => {
    loadBalances();
  }, [marketId, wallet.signedAccountId]);

  function fillPercent(percent: number) {
    if (!Number.isFinite(availableAmount) || availableAmount <= 0) {
      return;
    }

    const next = availableAmount * (percent / 100);
    setAmount(String(Number(next.toFixed(6))));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wallet.signedAccountId) {
      setError('Connect wallet before trading.');
      return;
    }

    if (!isOpen && !isSettled) {
      setError('Market is closed for trading and not settled yet. Redeem becomes available after settlement.');
      return;
    }

    const amountNumber = Number(amount);
    const slippageValue = Number(slippage) / 100;

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if ((isSettled || mode === 'Sell') && amountNumber > availableAmount) {
      setError('Amount exceeds available balance.');
      return;
    }

    setPending(true);
    setError('');

    try {
      if (isSettled) {
        await redeemWinningTokens(wallet, {
          marketId,
          amount: amountNumber,
        });
      } else if (mode === 'Buy') {
        await ensureUsdcBalanceWithOnramp(wallet, amountNumber);
        const refreshedCollateral = await fetchCollateralBalance(wallet);
        setCollateralBalance(refreshedCollateral);

        if (amountNumber > refreshedCollateral) {
          setError('Amount exceeds available balance.');
          return;
        }

        await buyOutcome(wallet, {
          marketId,
          outcome,
          collateralIn: amountNumber,
          minTokensOut: estimate * (1 - slippageValue),
        });
      } else {
        await sellOutcome(wallet, {
          marketId,
          outcome,
          tokensIn: amountNumber,
          minCollateralOut: estimate * (1 - slippageValue),
        });
      }

      await onTradeComplete();
      await loadBalances();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Transaction failed. Check wallet and contract setup.');
    } finally {
      setPending(false);
    }
  }

  async function handleManualTopUp() {
    if (!wallet.signedAccountId) {
      setError('Connect wallet before topping up USDC.');
      return;
    }

    setTopUpPending(true);
    setError('');
    try {
      await openUsdcOnramp();
      await loadBalances();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'USDC top up failed.');
    } finally {
      setTopUpPending(false);
    }
  }

  return (
    <section className="card trade-panel">
      <h2>{showRedeemPanel ? 'Redeem' : 'Trade'}</h2>

      {showRedeemPanel ? (
        <p className="muted">
          {isSettled
            ? `Market is settled. Redeem ${redeemOutcome ?? 'winning'} tokens for nUSD.`
            : 'Market is closed. Trading is disabled until a new resolution is submitted or the market is settled.'}
        </p>
      ) : (
        <>
          <div className="segmented">
            <button className={mode === 'Buy' ? 'active' : ''} onClick={() => setMode('Buy')} type="button">
              Buy
            </button>
            <button className={mode === 'Sell' ? 'active' : ''} onClick={() => setMode('Sell')} type="button">
              Sell
            </button>
          </div>

          <div className="trade-price-grid" aria-label="Current market prices">
            <div className={`trade-price-card ${outcome === 'Yes' ? 'trade-price-card--selected' : ''}`}>
              <span className="muted">Yes Price</span>
              <strong className="yes-text">{yesPrice.toFixed(2)}%</strong>
            </div>
            <div className={`trade-price-card ${outcome === 'No' ? 'trade-price-card--selected' : ''}`}>
              <span className="muted">No Price</span>
              <strong className="no-text">{noPrice.toFixed(2)}%</strong>
            </div>
          </div>
        </>
      )}

      {showRedeemPanel ? (
        <div className="segmented">
          <button className={redeemOutcome === 'Yes' ? 'active yes-button' : 'yes-button'} type="button" disabled>
            YES
          </button>
          <button className={redeemOutcome === 'No' ? 'active no-button' : 'no-button'} type="button" disabled>
            NO
          </button>
        </div>
      ) : (
        <div className="segmented">
          <button className={outcome === 'Yes' ? 'active yes-button' : 'yes-button'} onClick={() => setOutcome('Yes')} type="button">
            YES
          </button>
          <button className={outcome === 'No' ? 'active no-button' : 'no-button'} onClick={() => setOutcome('No')} type="button">
            NO
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="trade-balance-grid">
          <div>
            <span className="muted">nUSD Balance</span>
            <strong>{collateralBalance.toFixed(2)}</strong>
          </div>
          <div>
            <span className="muted">YES Balance</span>
            <strong>{yesBalance.toFixed(2)}</strong>
          </div>
          <div>
            <span className="muted">NO Balance</span>
            <strong>{noBalance.toFixed(2)}</strong>
          </div>
        </div>

        <label>
          {showRedeemPanel ? 'Redeem Tokens' : mode === 'Buy' ? 'Spend (USDC)' : 'Tokens'}
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            type="number"
            min="0"
            step="0.01"
            disabled={isClosed}
          />
        </label>

        <div className="percent-row">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              className="percent-button"
              onClick={() => fillPercent(percent)}
              disabled={balancesLoading || availableAmount <= 0}
            >
              {percent}%
            </button>
          ))}
          <span className="muted">
            Available {showRedeemPanel ? redeemOutcome ?? 'winning' : mode === 'Buy' ? 'nUSD' : outcome}: {availableAmount.toFixed(2)}
          </span>
        </div>

        {isOpen ? (
          <label>
            Slippage (%)
            <input value={slippage} onChange={(event) => setSlippage(event.target.value)} type="number" min="0" step="0.1" />
          </label>
        ) : null}

        <p className="muted">
          Estimated {showRedeemPanel ? 'nUSD out' : mode === 'Buy' ? 'tokens out' : 'USDC out'}: {estimate.toFixed(2)}
          {isOpen && mode === 'Buy' && estimating ? ' (updating...)' : ''}
        </p>

        {isOpen && mode === 'Buy' ? (
          <div className="trade-estimate-grid">
            <span className="muted">Current {outcome} price: {selectedPrice.toFixed(2)}%</span>
            <span className="muted">Opposite price: {oppositePrice.toFixed(2)}%</span>
            <span className="muted">Avg fill price: {averageFillPrice.toFixed(3)} nUSD/token</span>
            <span className="muted">Max payout if correct: {maxPayoutIfCorrect.toFixed(2)} nUSD</span>
          </div>
        ) : null}

        {shouldPromptMainnetBuyOnramp ? (
          <p className="onramp-hint">
            Insufficient USDC for this buy. Submitting will open Ping so you can top up, then continue.
          </p>
        ) : null}

        {onrampAvailable && isOpen ? (
          <div className="onramp-actions">
            <button
              className="cta-button"
              type="button"
              disabled={pending || topUpPending || !wallet.signedAccountId}
              onClick={handleManualTopUp}
            >
              {topUpPending ? 'Opening Ping...' : 'Top up USDC with Ping'}
            </button>
            {!wallet.signedAccountId ? <span className="muted">Connect wallet to top up.</span> : null}
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={pending || isClosed} className="cta-button">
          {pending
            ? 'Submitting...'
            : isSettled
              ? `Redeem ${redeemOutcome ?? ''}`.trim()
              : isClosed
                ? 'Redeem Unavailable'
                : `${mode} ${outcome}`}
        </button>
      </form>
    </section>
  );
}
