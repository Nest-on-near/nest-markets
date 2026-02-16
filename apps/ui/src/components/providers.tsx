'use client';

import { ReactNode } from 'react';
import { NearProvider } from 'near-connect-hooks';

import { NETWORK_ID } from '@/config';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <NearProvider config={{ network: NETWORK_ID }}>{children}</NearProvider>;
}
