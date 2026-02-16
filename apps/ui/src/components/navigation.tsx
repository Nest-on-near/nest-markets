'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';

import { ENABLE_ONRAMP_ON_TESTNET, NETWORK_ID } from '@/config';
import { formatAccount } from '@/lib/format';
import { isMainnetOnrampEnabled, setMainnetOnrampEnabled } from '@/lib/onramp';

const links = [
  { href: '/markets', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/create', label: 'Create' },
];

export function Navigation() {
  const pathname = usePathname();
  const { signedAccountId, loading, signIn, signOut } = useNearWallet();
  const [onrampEnabled, setOnrampEnabled] = useState(true);
  const onrampToggleAvailable = NETWORK_ID === 'mainnet' || (NETWORK_ID === 'testnet' && ENABLE_ONRAMP_ON_TESTNET);

  const isSignedIn = Boolean(signedAccountId);

  useEffect(() => {
    setOnrampEnabled(isMainnetOnrampEnabled());
  }, []);

  async function handleWalletAction() {
    if (isSignedIn) {
      await signOut();
      return;
    }

    await signIn();
  }

  function handleToggleOnramp(checked: boolean) {
    setOnrampEnabled(checked);
    setMainnetOnrampEnabled(checked);
  }

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <Link href="/" className="brand">
          <span className="brand__dot" />
          <span>Nest Markets</span>
        </Link>

        <nav className="top-nav__links">
          {links.map((link) => {
            const active = link.href === '/markets'
              ? pathname.startsWith('/markets')
              : pathname === link.href;

            return (
              <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="top-nav__actions">
          <label className="onramp-toggle">
            <input
              type="checkbox"
              checked={onrampEnabled}
              disabled={!onrampToggleAvailable}
              onChange={(event) => handleToggleOnramp(event.target.checked)}
            />
            <span>Mainnet USDC onramp</span>
          </label>

          <button className="wallet-button" onClick={handleWalletAction}>
            {loading ? 'Loading...' : isSignedIn ? formatAccount(signedAccountId) : 'Connect Wallet'}
          </button>
        </div>
      </div>
    </header>
  );
}
