declare module '@pingpay/onramp-types' {
  export interface TargetAsset {
    chain: string;
    asset: string;
  }

  export interface OnrampResult {
    [key: string]: unknown;
  }
}
