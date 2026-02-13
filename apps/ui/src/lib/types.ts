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
  volume: string;
  feeBps: number;
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
