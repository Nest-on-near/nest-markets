'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNearWallet } from 'near-connect-hooks';

import { formatAccount } from '@/lib/format';

const links = [
  { href: '/markets', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/create', label: 'Create' },
];

export function Navigation() {
  const pathname = usePathname();
  const { signedAccountId, loading, signIn, signOut } = useNearWallet();

  const isSignedIn = Boolean(signedAccountId);

  async function handleWalletAction() {
    if (isSignedIn) {
      await signOut();
      return;
    }

    await signIn();
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

        <button className="wallet-button" onClick={handleWalletAction}>
          {loading ? 'Loading...' : isSignedIn ? formatAccount(signedAccountId) : 'Connect Wallet'}
        </button>
      </div>
    </header>
  );
}
