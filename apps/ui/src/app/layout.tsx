import '@/app/globals.css';

import { ReactNode } from 'react';
import { Metadata } from 'next';

import { Navigation } from '@/components/navigation';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'Nest Markets',
    template: '%s | Nest Markets',
  },
  description: 'Prediction markets on NEAR with oracle-backed settlement.',
  applicationName: 'Nest Markets',
  openGraph: {
    title: 'Nest Markets',
    description: 'Prediction markets on NEAR with oracle-backed settlement.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nest Markets',
    description: 'Prediction markets on NEAR with oracle-backed settlement.',
  },
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Navigation />
          <main className="page-wrap">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
