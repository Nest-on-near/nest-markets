'use client';

import { FormEvent, useMemo, useState } from 'react';

import { DEFAULT_SLIPPAGE } from '@/config';
import { buyOutcome, sellOutcome } from '@/lib/markets';
import type { Outcome } from '@/lib/types';

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
  onTradeComplete: () => Promise<void>;
}

export function TradePanel({ wallet, marketId, yesPrice, noPrice, onTradeComplete }: TradePanelProps) {
  const [mode, setMode] = useState<'Buy' | 'Sell'>('Buy');
  const [outcome, setOutcome] = useState<Outcome>('Yes');
  const [amount, setAmount] = useState('10');
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const selectedPrice = outcome === 'Yes' ? yesPrice : noPrice;

  const estimate = useMemo(() => {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0 || selectedPrice <= 0) {
      return 0;
    }

    return mode === 'Buy' ? value / (selectedPrice / 100) : value * (selectedPrice / 100);
  }, [amount, mode, selectedPrice]);

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

    setPending(true);
    setError('');

    try {
      if (mode === 'Buy') {
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
    } catch {
      setError('Transaction failed. Check wallet and contract setup.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card trade-panel">
      <h2>Trade</h2>

      <div className="segmented">
        <button className={mode === 'Buy' ? 'active' : ''} onClick={() => setMode('Buy')} type="button">
          Buy
        </button>
        <button className={mode === 'Sell' ? 'active' : ''} onClick={() => setMode('Sell')} type="button">
          Sell
        </button>
      </div>

      <div className="segmented">
        <button className={outcome === 'Yes' ? 'active yes-button' : 'yes-button'} onClick={() => setOutcome('Yes')} type="button">
          YES
        </button>
        <button className={outcome === 'No' ? 'active no-button' : 'no-button'} onClick={() => setOutcome('No')} type="button">
          NO
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <label>
          {mode === 'Buy' ? 'Spend (USDC)' : 'Tokens'}
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" step="0.01" />
        </label>

        <label>
          Slippage (%)
          <input value={slippage} onChange={(event) => setSlippage(event.target.value)} type="number" min="0" step="0.1" />
        </label>

        <p className="muted">Estimated {mode === 'Buy' ? 'tokens out' : 'USDC out'}: {estimate.toFixed(2)}</p>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={pending} className="cta-button">
          {pending ? 'Submitting...' : `${mode} ${outcome}`}
        </button>
      </form>
    </section>
  );
}
