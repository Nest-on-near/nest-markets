import { formatUsd } from '@/lib/format';
import type { PositionView } from '@/lib/types';

interface PositionCardProps {
  position: PositionView;
}

export function PositionCard({ position }: PositionCardProps) {
  return (
    <article className="card position-card">
      <h3>{position.question}</h3>
      <div className="position-grid">
        <div>
          <span className="muted">YES Tokens</span>
          <strong>{position.yesBalance}</strong>
        </div>
        <div>
          <span className="muted">NO Tokens</span>
          <strong>{position.noBalance}</strong>
        </div>
        <div>
          <span className="muted">YES Value</span>
          <strong className="yes-text">{formatUsd(position.yesValue)}</strong>
        </div>
        <div>
          <span className="muted">NO Value</span>
          <strong className="no-text">{formatUsd(position.noValue)}</strong>
        </div>
      </div>
    </article>
  );
}
