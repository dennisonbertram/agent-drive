'use client';

import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { BrandMark } from '../../brand-mark';

/** Header shared by Billing and Activity pages; same link names as the console sidebar. */
export function AccountHeader({
  current,
  clerkEnabled,
}: {
  current: 'billing' | 'settings';
  clerkEnabled: boolean;
}) {
  return (
    <header className="billing-header">
      <BrandMark href="/console" />
      <nav className="billing-links" aria-label="Account">
        <Link href="/console/billing" aria-current={current === 'billing' ? 'page' : undefined}>
          Billing<span className="phone-hide"> &amp; limits</span>
        </Link>
        <Link href="/console/settings" aria-current={current === 'settings' ? 'page' : undefined}>
          Activity<span className="phone-hide"> &amp; deletion</span>
        </Link>
        <Link className="billing-links-cta" href="/console">
          Back to files
        </Link>
        {clerkEnabled && <UserButton />}
      </nav>
    </header>
  );
}
