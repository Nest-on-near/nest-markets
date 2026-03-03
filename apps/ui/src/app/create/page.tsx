'use client';

import { FormEvent, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';

import { createMarket } from '@/lib/markets';
import { ensureUsdcBalanceWithOnramp } from '@/lib/onramp';

const steps = ['Question', 'Details', 'Parameters', 'Review'];

export default function CreateMarketPage() {
  const wallet = useNearWallet();

  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [liquidity, setLiquidity] = useState('100');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [direction, setDirection] = useState(1);

  function next() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleCreate(event: FormEvent) {
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
      setMessage('Market creation transaction submitted! 🎉');
      setQuestion('');
      setDescription('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Market creation failed.');
    } finally {
      setLoading(false);
    }
  }

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
  };

  return (
    <section className="dk-page">
      {/* Header */}
      <motion.header
        className="dk-page__header"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="dk-page__title">Create Market</h1>
        <p className="dk-page__subtitle">Permissionless market creation with creator-seeded liquidity.</p>
      </motion.header>

      <motion.div
        className="dk-create-wrap"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        {/* Progress */}
        <div className="dk-progress">
          {steps.map((s, i) => (
            <div key={s} className={`dk-progress__step ${i <= step ? 'dk-progress__step--active' : ''} ${i < step ? 'dk-progress__step--done' : ''}`}>
              <div className="dk-progress__dot">
                {i < step ? <Check size={12} /> : <span>{i + 1}</span>}
              </div>
              <span className="dk-progress__label">{s}</span>
            </div>
          ))}
          <div className="dk-progress__line">
            <motion.div
              className="dk-progress__fill"
              animate={{ width: `${(step / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="dk-create-body">
          <AnimatePresence mode="wait" custom={direction}>
            {step === 0 && (
              <motion.div key="step-0" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.35 }} className="dk-step">
                <label className="dk-label">
                  <span>Market Question</span>
                  <span className="dk-label__count">{question.length}/200</span>
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value.slice(0, 200))}
                  placeholder="Will XYZ happen by date?"
                  rows={3}
                  className="dk-textarea"
                  autoFocus
                />
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="step-1" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.35 }} className="dk-step">
                <label className="dk-label">Description &amp; Resolution Criteria</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the settlement criteria and resolution source..."
                  rows={5}
                  className="dk-textarea"
                  autoFocus
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step-2" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.35 }} className="dk-step">
                <label className="dk-label">Resolution Date &amp; Time</label>
                <input
                  value={resolutionDate}
                  onChange={(e) => setResolutionDate(e.target.value)}
                  type="datetime-local"
                  className="dk-input"
                />

                <label className="dk-label" style={{ marginTop: '1.2rem' }}>Initial Liquidity (USDC)</label>
                <input
                  value={liquidity}
                  onChange={(e) => setLiquidity(e.target.value)}
                  type="number"
                  min="10"
                  step="0.01"
                  className="dk-input"
                  placeholder="100"
                />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step-3" custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.35 }} className="dk-step">
                <h3 className="dk-review-title">Review your market</h3>

                <div className="dk-review-card">
                  <div className="dk-review-row">
                    <span className="dk-review-key">Question</span>
                    <span className="dk-review-val">{question || '—'}</span>
                  </div>
                  <div className="dk-review-row">
                    <span className="dk-review-key">Description</span>
                    <span className="dk-review-val">{description || '—'}</span>
                  </div>
                  <div className="dk-review-row">
                    <span className="dk-review-key">Resolution</span>
                    <span className="dk-review-val">{resolutionDate ? new Date(resolutionDate).toLocaleString() : '—'}</span>
                  </div>
                  <div className="dk-review-row">
                    <span className="dk-review-key">Liquidity</span>
                    <span className="dk-review-val dk-review-val--accent">{liquidity} USDC</span>
                  </div>
                </div>

                {message && (
                  <motion.p
                    className="dk-message"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {message}
                  </motion.p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="dk-create-nav">
          {step > 0 && (
            <motion.button
              className="dk-btn dk-btn--ghost"
              onClick={back}
              whileHover={{ x: -3 }}
              whileTap={{ scale: 0.97 }}
            >
              <ArrowLeft size={16} /> Back
            </motion.button>
          )}
          <div style={{ flex: 1 }} />
          {step < steps.length - 1 ? (
            <motion.button
              className="dk-btn dk-btn--primary"
              onClick={next}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.97 }}
            >
              Next <ArrowRight size={16} />
            </motion.button>
          ) : (
            <motion.button
              className="dk-btn dk-btn--primary"
              onClick={handleCreate}
              disabled={loading}
              whileHover={!loading ? { scale: 1.02 } : {}}
              whileTap={!loading ? { scale: 0.98 } : {}}
            >
              {loading ? (
                <span className="dk-spinner" />
              ) : (
                <>
                  <Sparkles size={16} /> Create Market
                </>
              )}
            </motion.button>
          )}
        </div>
      </motion.div>
    </section>
  );
}
