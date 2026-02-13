import Link from 'next/link';

import { Reveal } from '@/components/ui/reveal';

export default function LandingPage() {
  return (
    <section className="playground">
      <div className="scene-top" aria-hidden="true">
        <span className="shape shape-a" />
        <span className="shape shape-b" />
        <span className="shape shape-c" />
        <span className="shape shape-d" />
        <span className="shape shape-e" />
      </div>

      <Reveal className="meadow-hero">
        <p className="eyebrow">Nest Markets</p>
        <h1>Ready when your conviction is.</h1>
        <p>
          Prediction markets with fast execution, clear probabilities, and oracle-backed resolution. Built to feel alive,
          not like a terminal.
        </p>
        <div className="hero-actions">
          <Link href="/markets" className="cta-link">Explore Markets</Link>
          <Link href="/create" className="subtle-link">Create Question</Link>
        </div>
      </Reveal>

      <Reveal className="story-line">
        <h2>Readable signal over dashboard noise.</h2>
        <p>
          Trade YES/NO outcomes in one clear flow. Follow the probability curve, not visual clutter.
        </p>
      </Reveal>

      <Reveal className="story-line">
        <h2>Resolution you can trust.</h2>
        <p>
          Markets settle through Nest Oracle assertion and dispute logic, so each outcome stays auditable.
        </p>
      </Reveal>

      <Reveal className="closing-strip">
        <span>Research, trade, settle, repeat.</span>
        <Link href="/portfolio">Open Portfolio</Link>
      </Reveal>
    </section>
  );
}
