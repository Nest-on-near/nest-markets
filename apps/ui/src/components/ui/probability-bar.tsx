import { formatPercent } from '@/lib/format';

interface ProbabilityBarProps {
  yes: number;
  no: number;
}

export function ProbabilityBar({ yes, no }: ProbabilityBarProps) {
  return (
    <div className="probability-wrap" aria-label="Outcome probability bar">
      <div className="probability-value yes" style={{ width: `${yes}%` }}>
        <span>{formatPercent(yes)}</span>
      </div>
      <div className="probability-value no" style={{ width: `${no}%` }}>
        <span>{formatPercent(no)}</span>
      </div>
    </div>
  );
}
