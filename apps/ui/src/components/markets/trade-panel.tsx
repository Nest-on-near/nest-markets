'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SLIPPAGE } from '@/config';
import {
  buyOutcome,
  estimateBuyTokens,
  fetchCollateralBalance,
  fetchOutcomeBalance,
  redeemWinningTokens,
  sellOutcome,
} from '@/lib/markets';
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
  const [estimating, setEstimating] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [collateralBalance, setCollateralBalance] = useState(0);
  const [yesBalance, setYesBalance] = useState(0);
  const [noBalance, setNoBalance] = useState(0);
  const [error, setError] = useState('');
  const isSettled = marketStatus === 'Settled';
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
    : mode === 'Buy'
      ? collateralBalance
      : outcome === 'Yes'
        ? yesBalance
        : noBalance;

  const amountNumber = Number(amount);
  const hasValidAmount = Number.isFinite(amountNumber) && amountNumber > 0;

  const averageFillPrice = useMemo(() => {
    if (!hasValidAmount || mode !== 'Buy' || isSettled || estimate <= 0) {
      return 0;
    }

    return amountNumber / estimate;
  }, [amountNumber, estimate, hasValidAmount, isSettled, mode]);

  const maxPayoutIfCorrect = useMemo(() => {
    if (mode !== 'Buy' || isSettled || estimate <= 0) {
      return 0;
    }

    return estimate;
  }, [estimate, isSettled, mode]);

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
    if (isSettled) {
      const redeemValue = Number(amount);
      setEstimate(Number.isFinite(redeemValue) && redeemValue > 0 ? redeemValue : 0);
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
  }, [amount, isSettled, localEstimate, marketId, mode, outcome, wallet]);

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

    const amountNumber = Number(amount);
    const slippageValue = Number(slippage) / 100;

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (amountNumber > availableAmount) {
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
    } catch {
      setError('Transaction failed. Check wallet and contract setup.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card trade-panel">
      <h2>{isSettled ? 'Redeem' : 'Trade'}</h2>

      {isSettled ? (
        <p className="muted">
          Market is settled. Redeem {redeemOutcome ?? 'winning'} tokens for nUSD.
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

      {isSettled ? (
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
          {isSettled ? 'Redeem Tokens' : mode === 'Buy' ? 'Spend (USDC)' : 'Tokens'}
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" step="0.01" />
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
            Available {isSettled ? redeemOutcome ?? 'winning' : mode === 'Buy' ? 'nUSD' : outcome}: {availableAmount.toFixed(2)}
          </span>
        </div>

        {!isSettled ? (
          <label>
            Slippage (%)
            <input value={slippage} onChange={(event) => setSlippage(event.target.value)} type="number" min="0" step="0.1" />
          </label>
        ) : null}

        <p className="muted">
          Estimated {isSettled ? 'nUSD out' : mode === 'Buy' ? 'tokens out' : 'USDC out'}: {estimate.toFixed(2)}
          {!isSettled && mode === 'Buy' && estimating ? ' (updating...)' : ''}
        </p>

        {!isSettled && mode === 'Buy' ? (
          <div className="trade-estimate-grid">
            <span className="muted">Current {outcome} price: {selectedPrice.toFixed(2)}%</span>
            <span className="muted">Opposite price: {oppositePrice.toFixed(2)}%</span>
            <span className="muted">Avg fill price: {averageFillPrice.toFixed(3)} nUSD/token</span>
            <span className="muted">Max payout if correct: {maxPayoutIfCorrect.toFixed(2)} nUSD</span>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={pending} className="cta-button">
          {pending ? 'Submitting...' : isSettled ? `Redeem ${redeemOutcome ?? ''}`.trim() : `${mode} ${outcome}`}
        </button>
      </form>
    </section>
  );
}
