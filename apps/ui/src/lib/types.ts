export type Outcome = 'Yes' | 'No';

export type MarketStatus =
  | 'Open'
  | 'Closed'
  | 'Resolving'
  | 'Disputed'
  | 'Settled'
  | 'Unknown';

export interface MarketView {
  id: number;
  question: string;
  description: string;
  resolutionTimeNs: string;
  creator: string;
  status: MarketStatus;
  outcome: Outcome | null;
  yesReserve: string;
  noReserve: string;
  yesPrice: string;
  noPrice: string;
  totalCollateral: string;
  feeBps: number;
  assertionId: string | null;
  assertedOutcome: Outcome | null;
  resolver: string | null;
  disputer: string | null;
  assertionSubmittedAtNs: string | null;
  assertionExpiresAtNs: string | null;
}

export interface PriceView {
  yes: string;
  no: string;
}

export interface PositionView {
  marketId: number;
  question: string;
  yesBalance: string;
  noBalance: string;
  yesValue: number;
  noValue: number;
}

export interface IndexedPricePoint {
  blockHeight: number;
  timestampMs: number;
  yes: number;
  no: number;
  yesRaw: string;
  noRaw: string;
}

export interface MarketActivityItem {
  eventType: string;
  blockHeight: number;
  timestampMs: number;
  blockTimestampNs: string;
  transactionId: string;
  receiptId: string;
  data: Record<string, unknown>;
}

export interface ResolutionStatusView {
  marketId: number;
  status: string;
  outcome: Outcome | null;
  assertionId: string | null;
  resolver: string | null;
  disputer: string | null;
  submittedBlockHeight: number | null;
  disputedBlockHeight: number | null;
  settledBlockHeight: number | null;
  submittedTimestampNs: string | null;
  disputedTimestampNs: string | null;
  settledTimestampNs: string | null;
  livenessDeadlineNs: string | null;
  isResolvableNow: boolean | null;
  isDisputableNow: boolean | null;
}
