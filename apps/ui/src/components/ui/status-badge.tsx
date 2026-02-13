import type { MarketStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: MarketStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status}</span>;
}
