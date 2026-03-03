'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform, useSpring, useInView, AnimatePresence } from 'framer-motion';
import { ArrowRight, TrendingUp, Shield, Zap, ChevronDown } from 'lucide-react';
import { PredictionMarketCard } from '@/components/ui/prediction-market-card';

/* ─── Animated ticker tape ─── */
function TickerTape() {
  const items = [
    { q: 'ETH > $5K by Q3?', yes: 67, delta: +2.3 },
    { q: 'BTC halving pump?', yes: 74, delta: +5.1 },
    { q: 'SOL flips BNB?', yes: 38, delta: -1.8 },
    { q: 'Fed rate cut June?', yes: 52, delta: +0.7 },
    { q: 'NEAR hits $20?', yes: 45, delta: +3.2 },
    { q: 'AI token rally?', yes: 81, delta: +4.6 },
    { q: 'L2 TVL > $50B?', yes: 62, delta: -0.9 },
    { q: 'Stablecoin bill?', yes: 71, delta: +1.4 },
  ];
  const doubled = [...items, ...items];

  return (
    <div className="ticker-tape-wrap">
      <div className="ticker-tape">
        {doubled.map((item, i) => (
          <div key={i} className="ticker-item">
            <span className="ticker-q">{item.q}</span>
            <span className="ticker-yes">{item.yes}¢</span>
            <span className={`ticker-delta ${item.delta >= 0 ? 'up' : 'down'}`}>
              {item.delta >= 0 ? '▲' : '▼'} {Math.abs(item.delta)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Scroll-linked probability chart (SVG) ─── */
function ScrollChart() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const spring = useSpring(scrollYProgress, { stiffness: 60, damping: 20 });

  const [pathLen, setPathLen] = useState(0);
  const yesRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (yesRef.current) setPathLen(yesRef.current.getTotalLength());
  }, []);

  // Generate realistic-looking probability curves
  const W = 900, H = 300;
  const yesPoints = [
    [0, 170], [60, 155], [120, 140], [180, 160], [240, 130],
    [300, 110], [360, 125], [420, 95], [480, 105], [540, 80],
    [600, 90], [660, 70], [720, 85], [780, 60], [840, 50], [900, 65],
  ];
  const noPoints = yesPoints.map(([x, y]) => [x, H - y + 40]);

  const toPath = (pts: number[][]) =>
    pts.reduce((d, [x, y], i) => {
      if (i === 0) return `M${x},${y}`;
      const prev = pts[i - 1];
      const cpx = (prev[0] + x) / 2;
      return `${d} C${cpx},${prev[1]} ${cpx},${y} ${x},${y}`;
    }, '');

  const yesD = toPath(yesPoints);
  const noD = toPath(noPoints);

  return (
    <div ref={ref} className="scroll-chart-section">
      <div className="scroll-chart-inner">
        <div className="scroll-chart-header">
          <h2 className="section-title">Watch the market move.</h2>
          <p className="section-subtitle">
            Scroll to see probability curves animate — just like prices on a live exchange.
          </p>
        </div>

        <div className="scroll-chart-container">
          {/* Grid labels */}
          <div className="chart-y-labels">
            <span>100¢</span><span>75¢</span><span>50¢</span><span>25¢</span><span>0¢</span>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="scroll-chart-svg" preserveAspectRatio="none">
            {/* Grid */}
            {[0, 1, 2, 3, 4].map(i => (
              <line key={i} x1={0} y1={i * (H / 4)} x2={W} y2={i * (H / 4)}
                stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
            ))}

            {/* Area fills */}
            <defs>
              <linearGradient id="yesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00EC97" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#00EC97" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="noGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#de4d8f" stopOpacity="0" />
                <stop offset="100%" stopColor="#de4d8f" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path d={`${yesD} L${W},${H} L0,${H} Z`} fill="url(#yesGrad)" />
            <path d={`${noD} L${W},${H} L0,${H} Z`} fill="url(#noGrad)" />

            {/* Lines */}
            <motion.path
              ref={yesRef}
              d={yesD}
              fill="none"
              stroke="#00EC97"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                pathLength: spring,
              }}
            />
            <motion.path
              d={noD}
              fill="none"
              stroke="#de4d8f"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                pathLength: spring,
              }}
            />

            {/* Moving dots */}
            <motion.circle
              cx={900}
              cy={65}
              r="5"
              fill="#00EC97"
              style={{ opacity: spring }}
              filter="drop-shadow(0 0 6px #00EC97)"
            />
            <motion.circle
              cx={900}
              cy={275}
              r="5"
              fill="#de4d8f"
              style={{ opacity: spring }}
              filter="drop-shadow(0 0 6px #de4d8f)"
            />
          </svg>

          {/* Legend */}
          <div className="chart-legend">
            <div className="chart-legend-item">
              <span className="legend-dot yes" />
              <span>YES — 65¢</span>
            </div>
            <div className="chart-legend-item">
              <span className="legend-dot no" />
              <span>NO — 35¢</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Glassmorphism feature cards ─── */
const features = [
  {
    icon: TrendingUp,
    title: 'Trade with Clarity',
    desc: 'YES/NO outcomes — no complex options chains. See the probability, make your call.',
    gradient: 'from-[#00EC97]/20 to-[#00EC97]/5',
    iconColor: '#00EC97',
  },
  {
    icon: Shield,
    title: 'Oracle-Backed Resolution',
    desc: 'Markets settle through Nest Oracle assertion and dispute logic. Every outcome is auditable.',
    gradient: 'from-blue-500/20 to-blue-500/5',
    iconColor: '#55aef5',
  },
  {
    icon: Zap,
    title: 'Real-time Probability',
    desc: 'Live price feeds powered by CPMM. Watch probabilities shift with each trade.',
    gradient: 'from-amber-500/20 to-amber-500/5',
    iconColor: '#f6df32',
  },
];

function FeatureCards() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <div ref={ref} className="features-section">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="features-header"
      >
        <h2 className="section-title">Built for conviction.</h2>
        <p className="section-subtitle">
          Everything you need to trade prediction markets with confidence.
        </p>
      </motion.div>

      <div className="features-grid">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.6, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="feature-card"
          >
            <div className={`feature-icon-wrap bg-gradient-to-br ${f.gradient}`}>
              <f.icon size={24} color={f.iconColor} />
            </div>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-desc">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ─── Floating particles background ─── */
function FloatingParticles() {
  const [particles, setParticles] = useState<Array<{ left: string; top: string; delay: string; dur: string; size: string; opacity: number }>>([]);

  useEffect(() => {
    setParticles(
      Array.from({ length: 20 }).map(() => ({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        delay: `${Math.random() * 8}s`,
        dur: `${6 + Math.random() * 8}s`,
        size: `${2 + Math.random() * 4}px`,
        opacity: 0.1 + Math.random() * 0.3,
      }))
    );
  }, []);

  if (particles.length === 0) return null;

  return (
    <div className="particles-container" aria-hidden="true">
      {particles.map((p, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: p.left,
            top: p.top,
            animationDelay: p.delay,
            animationDuration: p.dur,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Main Landing Page ─── */
export default function LandingPage() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);
  const heroY = useTransform(scrollYProgress, [0, 0.5], [0, -60]);

  const cardRef = useRef(null);
  const cardInView = useInView(cardRef, { once: true, margin: '-100px' });

  const ctaRef = useRef(null);
  const ctaInView = useInView(ctaRef, { once: true, margin: '-60px' });

  return (
    <div className="landing-root">
      <FloatingParticles />

      {/* ── HERO ── */}
      <motion.section ref={heroRef} className="hero-section" style={{ opacity: heroOpacity, scale: heroScale, y: heroY }}>
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-glow-2" aria-hidden="true" />

        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.span
            className="hero-eyebrow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            NEST MARKETS · on NEAR
          </motion.span>

          <motion.h1
            className="hero-headline"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            Ready when your<br />
            <span className="hero-headline-accent">conviction</span> is.
          </motion.h1>

          <motion.p
            className="hero-desc"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            Prediction markets with fast execution, clear probabilities,<br />
            and oracle-backed resolution. Built to feel alive.
          </motion.p>

          <motion.div
            className="hero-actions-row"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <Link href="/markets" className="hero-cta-primary">
              Explore Markets <ArrowRight size={18} />
            </Link>
            <Link href="/create" className="hero-cta-secondary">
              Create Question
            </Link>
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          className="scroll-indicator"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <ChevronDown size={20} className="scroll-indicator-icon" />
        </motion.div>
      </motion.section>

      {/* ── TICKER ── */}
      <TickerTape />

      {/* ── SCROLL CHART ── */}
      <ScrollChart />

      {/* ── FEATURES ── */}
      <FeatureCards />

      {/* ── CARD SHOWCASE ── */}
      <section ref={cardRef} className="showcase-section">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={cardInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="showcase-header"
        >
          <h2 className="section-title">Experience prediction trading.</h2>
          <p className="section-subtitle">Interactive, real-time, and built for speed. Try it below.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.92 }}
          animate={cardInView ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="showcase-card-wrap"
        >
          <div className="showcase-glow" aria-hidden="true" />
          <PredictionMarketCard />
        </motion.div>
      </section>

      {/* ── CTA ── */}
      <section ref={ctaRef} className="cta-section">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={ctaInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="cta-inner"
        >
          <h2 className="cta-title">Research. Trade. Settle. Repeat.</h2>
          <p className="cta-desc">
            Join the next generation of prediction markets on NEAR.
          </p>
          <div className="cta-buttons">
            <Link href="/markets" className="hero-cta-primary">
              Start Trading <ArrowRight size={18} />
            </Link>
            <Link href="/portfolio" className="hero-cta-secondary">
              Open Portfolio
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="footer-dot" />
            <span>Nest Markets</span>
          </div>
          <p className="footer-text">Prediction markets on NEAR with oracle-backed settlement.</p>
        </div>
      </footer>
    </div>
  );
}
