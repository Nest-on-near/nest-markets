'use client';

import { FormEvent, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';

import { createMarket } from '@/lib/markets';
import { ensureUsdcBalanceWithOnramp } from '@/lib/onramp';

export default function CreateMarketPage() {
  const wallet = useNearWallet();

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [liquidity, setLiquidity] = useState('100');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wallet.signedAccountId) {
      setMessage('Connect wallet before creating a market.');
      return;
    }

    const resolutionMs = new Date(resolutionDate).getTime();
    const liquidityAmount = Number(liquidity);

    if (!resolutionMs || resolutionMs <= Date.now()) {
      setMessage('Select a valid future resolution date.');
      return;
    }
    if (!Number.isFinite(liquidityAmount) || liquidityAmount <= 0) {
      setMessage('Enter a valid initial liquidity amount.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      await ensureUsdcBalanceWithOnramp(wallet, liquidityAmount);

      await createMarket(wallet, {
        question,
        description,
        initialLiquidity: liquidityAmount,
        resolutionTimeNs: (resolutionMs * 1_000_000).toString(),
      });

      setMessage('Market creation transaction submitted.');
      setQuestion('');
      setDescription('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Market creation failed. Check token contract and allowances.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-content">
      <header className="hero">
        <h1>Create Market</h1>
        <p>Permissionless market creation with creator-seeded liquidity.</p>
      </header>

      <form className="card create-form" onSubmit={handleCreate}>
        <label>
          Question
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            required
            placeholder="Will XYZ happen by date?"
          />
        </label>

        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={4}
            placeholder="Resolution source and settlement criteria"
          />
        </label>

        <label>
          Resolution Time
          <input
            value={resolutionDate}
            onChange={(event) => setResolutionDate(event.target.value)}
            type="datetime-local"
            required
          />
        </label>

        <label>
          Initial Liquidity (USDC)
          <input
            value={liquidity}
            onChange={(event) => setLiquidity(event.target.value)}
            type="number"
            min="10"
            step="0.01"
            required
          />
        </label>

        <button className="cta-button" disabled={loading} type="submit">
          {loading ? 'Submitting...' : 'Create Market'}
        </button>

        {message ? <p className="muted">{message}</p> : null}
      </form>
    </section>
  );
}
