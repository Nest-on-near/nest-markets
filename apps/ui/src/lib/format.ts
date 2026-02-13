import { USDC_SCALE } from '@/config';

export function toChainAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return '0';
  }

  return Math.floor(amount * USDC_SCALE).toString();
}

export function fromChainAmount(raw: string | number | bigint): number {
  const value = typeof raw === 'bigint' ? Number(raw) : Number(raw);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return value / USDC_SCALE;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatAccount(accountId: string): string {
  if (accountId.length <= 18) {
    return accountId;
  }

  return `${accountId.slice(0, 8)}...${accountId.slice(-8)}`;
}

export function formatResolutionTime(ns: string): string {
  const ms = Number(ns) / 1_000_000;

  if (!Number.isFinite(ms) || ms <= 0) {
    return 'Unknown';
  }

  return new Date(ms).toLocaleString();
}
