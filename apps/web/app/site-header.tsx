import Link from 'next/link';
import { BrandMark } from './brand-mark';
import './styles/site-header.css';

type Current = 'pricing' | 'sign-in' | 'sign-up';

/**
 * Public header for /, /pricing, /sign-in and /sign-up. It never reads the session: Clerk
 * middleware does not run on / and /pricing, so calling auth() there would throw.
 */
export function SiteHeader({ current }: { current?: Current }) {
  const page = (name: Current) => (current === name ? ('page' as const) : undefined);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <BrandMark />
        <nav id="site-nav" className="site-nav" popover="auto" aria-label="Main">
          <Link href="/pricing" aria-current={page('pricing')}>
            Pricing
          </Link>
          <a href="/llms.txt">Docs</a>
          <Link href="/sign-in" aria-current={page('sign-in')}>
            Sign in
          </Link>
        </nav>
        <button className="site-menu" popoverTarget="site-nav" type="button">
          Menu
        </button>
        <Link className="site-signup" href="/sign-up" aria-current={page('sign-up')}>
          Sign up free
        </Link>
      </div>
    </header>
  );
}

/** Same-origin paths only (one leading slash); anything else is dropped. */
export const safeRedirect = (v: string | string[] | undefined) =>
  typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : undefined;

/** One-line cross-link under the sign-in and sign-up cards. */
export function AuthLinks({
  to,
  redirect,
}: {
  to: 'sign-in' | 'sign-up';
  redirect?: string | undefined;
}) {
  const href = `/${to}${redirect ? `?redirect_url=${encodeURIComponent(redirect)}` : ''}`;
  return (
    <p className="auth-links">
      {to === 'sign-up' ? 'New here? ' : 'Already have an account? '}
      <Link href={href}>{to === 'sign-up' ? 'Create a free account' : 'Sign in'}</Link>
      {' · '}
      <Link href="/pricing">Pricing</Link>
      {' · '}
      <a href="/llms.txt">Docs</a>
    </p>
  );
}
