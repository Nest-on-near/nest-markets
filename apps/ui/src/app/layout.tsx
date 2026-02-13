'use client';

import '@/app/globals.css';

import { ReactNode } from 'react';
import { NearProvider } from 'near-connect-hooks';

import { NETWORK_ID } from '@/config';
import { Navigation } from '@/components/navigation';

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <NearProvider config={{ network: NETWORK_ID }}>
          <Navigation />
          <main className="page-wrap">{children}</main>
        </NearProvider>
      </body>
    </html>
  );
}
