"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PredictionMarketCardProps {
    question?: string;
    teamLogo?: string;
    teamName?: string;
    initialTimeInSeconds?: number;
    totalBank?: number;
    yesBank?: number;
    noBank?: number;
    initialYesVotes?: number;
    initialNoVotes?: number;
    yesPlayers?: number;
    noPlayers?: number;
    onBetYes?: () => void;
    onBetNo?: () => void;
}

export function PredictionMarketCard({
    question = "Will NEAR hit $20 by end of Q2?",
    teamLogo = "https://cryptologos.cc/logos/near-protocol-near-logo.png",
    teamName = "NEAR",
    initialTimeInSeconds = 3600,
    totalBank = 87320,
    yesBank = 51890,
    noBank = 35430,
    initialYesVotes = 63,
    initialNoVotes = 37,
    yesPlayers = 2134,
    noPlayers = 1287,
    onBetYes,
    onBetNo,
}: PredictionMarketCardProps) {
    const [timeLeft, setTimeLeft] = useState(initialTimeInSeconds);
    const [yesVotes, setYesVotes] = useState(initialYesVotes);
    const [noVotes, setNoVotes] = useState(initialNoVotes);
    const [showBetting, setShowBetting] = useState(false);
    const [betType, setBetType] = useState<'yes' | 'no'>('yes');
    const [betAmount, setBetAmount] = useState('');

    useEffect(() => {
        if (timeLeft <= 0) return;
        const id = setInterval(() => setTimeLeft((p) => Math.max(0, p - 1)), 1000);
        return () => clearInterval(id);
    }, [timeLeft]);

    const fmt = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
            : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const money = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`;

    const totalVotes = yesVotes + noVotes;
    const yesPct = (yesVotes / totalVotes) * 100;

    function openBet(type: 'yes' | 'no') {
        setBetType(type);
        setBetAmount('');
        setShowBetting(true);
    }

    function confirmBet() {
        const adj = Math.floor(Math.random() * 3) + 1;
        if (betType === 'yes') {
            setYesVotes((p) => Math.min(95, p + adj));
            setNoVotes((p) => Math.max(5, p - adj));
            onBetYes?.();
        } else {
            setNoVotes((p) => Math.min(95, p + adj));
            setYesVotes((p) => Math.max(5, p - adj));
            onBetNo?.();
        }
        setShowBetting(false);
    }

    return (
        <motion.div
            className="pmc"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
            {/* Glow ring */}
            <div className="pmc__glow" />

            <AnimatePresence mode="wait">
                {!showBetting ? (
                    <motion.div
                        key="main"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -30, scale: 0.95 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="pmc__body"
                    >
                        {/* Header badges */}
                        <div className="pmc__header">
                            <div className="pmc__badges">
                                <span className="pmc__badge pmc__badge--hot">🔥 HOT</span>
                                <span className="pmc__badge pmc__badge--cat">CRYPTO</span>
                            </div>
                            <span className="pmc__timer">{fmt(timeLeft)}</span>
                        </div>

                        {/* Question */}
                        <div className="pmc__question-row">
                            <div className="pmc__avatar">
                                <img src={teamLogo} alt={teamName} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                <span className="pmc__avatar-fallback">{teamName[0]}</span>
                            </div>
                            <h3 className="pmc__question">{question}</h3>
                        </div>

                        {/* Divider */}
                        <div className="pmc__divider" />

                        {/* Bank stats */}
                        <div className="pmc__stats">
                            <div className="pmc__stat">
                                <span className="pmc__stat-label">Total Bank</span>
                                <span className="pmc__stat-value pmc__stat-value--gold">{money(totalBank)}</span>
                            </div>
                            <div className="pmc__stat">
                                <span className="pmc__stat-label">Bank <strong>YES</strong></span>
                                <span className="pmc__stat-value pmc__stat-value--green">{money(yesBank)}</span>
                            </div>
                            <div className="pmc__stat">
                                <span className="pmc__stat-label">Bank <strong>NO</strong></span>
                                <span className="pmc__stat-value pmc__stat-value--rose">{money(noBank)}</span>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="pmc__divider" />

                        {/* Votes + bar */}
                        <div className="pmc__votes-header">
                            <div>
                                <span className="pmc__vote-label">YES</span>
                                <motion.span
                                    className="pmc__vote-pct pmc__vote-pct--green"
                                    key={yesVotes}
                                    initial={{ scale: 1.3, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: "spring" as const, stiffness: 500, damping: 25 }}
                                >
                                    {yesVotes}%
                                </motion.span>
                            </div>
                            <div>
                                <span className="pmc__vote-label pmc__vote-label--right">NO</span>
                                <motion.span
                                    className="pmc__vote-pct pmc__vote-pct--rose"
                                    key={noVotes}
                                    initial={{ scale: 1.3, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: "spring" as const, stiffness: 500, damping: 25 }}
                                >
                                    {noVotes}%
                                </motion.span>
                            </div>
                        </div>

                        <div className="pmc__bar-track">
                            <motion.div
                                className="pmc__bar-fill"
                                initial={{ width: 0 }}
                                animate={{ width: `${yesPct}%` }}
                                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                            />
                            <div className="pmc__bar-notch" style={{ left: `${yesPct}%` }} />
                        </div>

                        <div className="pmc__players">
                            <span>{yesPlayers.toLocaleString()} players</span>
                            <span>{noPlayers.toLocaleString()} players</span>
                        </div>

                        {/* Action buttons */}
                        <div className="pmc__actions">
                            <motion.button
                                className="pmc__btn pmc__btn--yes"
                                onClick={() => openBet('yes')}
                                whileHover={{ scale: 1.03, y: -2 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: "spring" as const, stiffness: 400, damping: 20 }}
                            >
                                <span>BET YES</span>
                                <span className="pmc__btn-arrow">↗</span>
                            </motion.button>
                            <motion.button
                                className="pmc__btn pmc__btn--no"
                                onClick={() => openBet('no')}
                                whileHover={{ scale: 1.03, y: -2 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: "spring" as const, stiffness: 400, damping: 20 }}
                            >
                                <span>BET NO</span>
                                <span className="pmc__btn-arrow">↘</span>
                            </motion.button>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="betting"
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 30, scale: 0.95 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="pmc__body"
                    >
                        {/* Betting header */}
                        <div className="pmc__header">
                            <motion.button
                                className="pmc__back"
                                onClick={() => setShowBetting(false)}
                                whileHover={{ x: -3 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                ← Back
                            </motion.button>
                            <span className="pmc__timer">{fmt(timeLeft)}</span>
                        </div>

                        <h3 className="pmc__question pmc__question--sm">{question}</h3>

                        {/* Bet type indicator */}
                        <div className="pmc__bet-type-wrap">
                            <span className={`pmc__bet-type ${betType === 'yes' ? 'pmc__bet-type--yes' : 'pmc__bet-type--no'}`}>
                                {betType === 'yes' ? 'YES ↗' : 'NO ↘'}
                            </span>
                        </div>

                        {/* Amount input */}
                        <div className="pmc__input-wrap">
                            <span className="pmc__input-prefix">$</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={betAmount}
                                onChange={(e) => setBetAmount(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="0"
                                className="pmc__input"
                                autoFocus
                            />
                        </div>

                        {/* Quick amounts */}
                        <div className="pmc__quick-amounts">
                            {[10, 25, 50, 100].map((amt) => (
                                <motion.button
                                    key={amt}
                                    className="pmc__quick-btn"
                                    onClick={() => setBetAmount(String(amt))}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    +${amt}
                                </motion.button>
                            ))}
                        </div>

                        {/* Confirm */}
                        <motion.button
                            className={`pmc__confirm ${betType === 'yes' ? 'pmc__confirm--yes' : 'pmc__confirm--no'} ${!betAmount ? 'pmc__confirm--disabled' : ''}`}
                            onClick={confirmBet}
                            disabled={!betAmount}
                            whileHover={betAmount ? { scale: 1.02, y: -2 } : {}}
                            whileTap={betAmount ? { scale: 0.98 } : {}}
                        >
                            CONFIRM BET
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Timer progress bar at bottom */}
            <div className="pmc__timer-track">
                <motion.div
                    className="pmc__timer-fill"
                    initial={{ width: '100%' }}
                    animate={{ width: `${(timeLeft / initialTimeInSeconds) * 100}%` }}
                    transition={{ duration: 1, ease: 'linear' }}
                />
            </div>
        </motion.div>
    );
}
