'use client';

import {
  ENABLE_ONRAMP_ON_TESTNET,
  NETWORK_ID,
  PINGPAY_POPUP_URL,
  PINGPAY_USDC_ASSET_ID,
} from '@/config';
import { fetchCollateralBalance } from '@/lib/markets';

interface WalletLike {
  callFunction: (args: {
    contractId: string;
    method: string;
    args?: Record<string, unknown>;
    gas?: string;
    deposit?: string;
  }) => Promise<unknown>;
  viewFunction: (args: { contractId: string; method: string; args?: Record<string, unknown> }) => Promise<unknown>;
  signedAccountId: string;
}

const MAINNET_ONRAMP_TOGGLE_KEY = 'nest_markets_mainnet_onramp_enabled';
const BALANCE_POLL_ATTEMPTS = 15;
const BALANCE_POLL_INTERVAL_MS = 2000;

type TargetAsset = {
  chain: string;
  asset: string;
};

type PingpayOnrampInstance = {
  initiateOnramp: (target: TargetAsset) => Promise<unknown>;
  close: () => void;
};

type PingpayOnrampCtor = new (config?: {
  targetAsset?: TargetAsset;
  popupUrl?: string;
  onPopupReady?: () => void;
  onPopupClose?: () => void;
}) => PingpayOnrampInstance;
type PingpayOnrampErrorCtor = new (...args: unknown[]) => Error;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isMainnetOnrampEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem(MAINNET_ONRAMP_TOGGLE_KEY);
  if (stored === null) {
    return true;
  }

  return stored === '1';
}

export function setMainnetOnrampEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MAINNET_ONRAMP_TOGGLE_KEY, enabled ? '1' : '0');
}

export function shouldRunMainnetOnrampGate(): boolean {
  const isOnrampNetwork = NETWORK_ID === 'mainnet' || (NETWORK_ID === 'testnet' && ENABLE_ONRAMP_ON_TESTNET);
  return isOnrampNetwork && isMainnetOnrampEnabled();
}

async function loadPingpaySdk(): Promise<{
  PingpayOnramp: PingpayOnrampCtor;
  PingpayOnrampError?: PingpayOnrampErrorCtor;
}> {
  return import('@pingpay/onramp-sdk') as Promise<{
    PingpayOnramp: PingpayOnrampCtor;
    PingpayOnrampError?: PingpayOnrampErrorCtor;
  }>;
}

const USDC_TARGET_ASSET: TargetAsset = {
  chain: 'NEAR',
  asset: PINGPAY_USDC_ASSET_ID,
};

async function launchUsdcOnramp(): Promise<void> {
  let PingpayOnramp: PingpayOnrampCtor;
  let PingpayOnrampError: PingpayOnrampErrorCtor | undefined;

  try {
    const sdk = await loadPingpaySdk();
    PingpayOnramp = sdk.PingpayOnramp;
    PingpayOnrampError = sdk.PingpayOnrampError;
  } catch {
    throw new Error('USDC onramp SDK is unavailable. Install @pingpay/onramp-sdk to enable onramp.');
  }

  const onramp = new PingpayOnramp({
    targetAsset: USDC_TARGET_ASSET,
    popupUrl: PINGPAY_POPUP_URL,
  });

  try {
    await onramp.initiateOnramp(USDC_TARGET_ASSET);
  } catch (error) {
    if (PingpayOnrampError && error instanceof PingpayOnrampError) {
      throw new Error(`USDC onramp failed: ${error.message}`);
    }
    if (error instanceof Error && error.message) {
      throw new Error(`USDC onramp failed: ${error.message}`);
    }
    throw new Error(`USDC onramp failed due to an unexpected error: ${String(error)}`);
  } finally {
    onramp.close();
  }
}

export async function openUsdcOnramp(): Promise<void> {
  if (!shouldRunMainnetOnrampGate()) {
    throw new Error('USDC onramp is not enabled for this network.');
  }

  await launchUsdcOnramp();
}

export async function ensureUsdcBalanceWithOnramp(wallet: WalletLike, requiredAmount: number): Promise<void> {
  if (!wallet.signedAccountId || !shouldRunMainnetOnrampGate()) {
    return;
  }

  const currentBalance = await fetchCollateralBalance(wallet);
  if (currentBalance >= requiredAmount) {
    return;
  }

  await launchUsdcOnramp();

  for (let attempt = 0; attempt < BALANCE_POLL_ATTEMPTS; attempt += 1) {
    const refreshedBalance = await fetchCollateralBalance(wallet);
    if (refreshedBalance >= requiredAmount) {
      return;
    }
    await sleep(BALANCE_POLL_INTERVAL_MS);
  }

  throw new Error(`USDC balance is still below required amount (${requiredAmount.toFixed(2)} USDC).`);
}
