'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { Navigation } from '@/components/navigation';

interface LayoutShellProps {
    children: ReactNode;
}

export function LayoutShell({ children }: LayoutShellProps) {
    const pathname = usePathname();
    const isLanding = pathname === '/';

    return (
        <>
            <Navigation dark />
            {isLanding ? (
                <main>{children}</main>
            ) : (
                <main className="page-wrap">{children}</main>
            )}
        </>
    );
}
