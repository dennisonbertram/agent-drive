import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { SiteMenuButton } from './site-menu';
import './styles/site-header.css';

type Current = 'pricing' | 'sign-in' | 'sign-up';

/** /sign-in or /sign-up href, keeping an already-validated redirect when there is one. */
export function authHref(to: 'sign-in' | 'sign-up', redirect?: string | undefined) {
  return `/${to}${redirect ? `?redirect_url=${encodeURIComponent(redirect)}` : ''}`;
}

/**
 * Public header for /, /pricing, /sign-in and /sign-up. It never reads the session: Clerk
 * middleware does not run on / and /pricing, so calling auth() there would throw.
 */
export function SiteHeader({
  current,
  redirect,
}: {
  current?: Current;
  redirect?: string | undefined;
}) {
  const page = (name: Current) => (current === name ? ('page' as const) : undefined);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <BrandMark />
        <nav id="site-nav" className="site-nav" popover="auto" aria-label="Main">
          <Link href="/pricing" aria-current={page('pricing')}>
            Pricing
          </Link>
          <Link href="/docs">Docs</Link>
          <Link href={authHref('sign-in', redirect)} aria-current={page('sign-in')}>
            Sign in
          </Link>
        </nav>
        <SiteMenuButton />
        <Link
          className="site-signup"
          href={authHref('sign-up', redirect)}
          aria-current={page('sign-up')}
        >
          Sign up free
        </Link>
      </div>
    </header>
  );
}

/**
 * Same-origin paths only. Rejects backslashes and control or whitespace characters (browsers
 * treat "/\\evil" and "/<tab>/evil" as other origins), then resolves the value against a
 * placeholder origin and keeps it only if it stays on that origin.
 *
 * Clerk's auth.protect() sends an absolute redirect_url on this deployment's own origin. An
 * http(s) value is kept only when its parsed URL.origin matches the canonical deployment
 * origin — so an explicit default port like ":443" still matches — and it carries no
 * userinfo. It is then reduced to path+query+fragment and re-checked the same way as a
 * relative value, which also rejects a "//" pathname left over after serialization.
 */
export function safeRedirect(v: string | string[] | undefined, origin?: string) {
  if (typeof v !== 'string' || /[\\\s\u0000-\u001f\u007f]/.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) {
    if (!origin) return undefined;
    try {
      const u = new URL(v);
      if (u.username || u.password || u.origin !== new URL(origin).origin) return undefined;
      v = u.pathname + u.search + u.hash;
    } catch {
      return undefined;
    }
  }
  if (!v.startsWith('/')) return undefined;
  const base = 'https://placeholder.invalid';
  try {
    const u = new URL(v, base);
    if (u.origin !== base || u.pathname.startsWith('//')) return undefined;
    return u.pathname + u.search + u.hash;
  } catch {
    return undefined;
  }
}

/** One-line cross-link under the sign-in and sign-up cards. */
export function AuthLinks({
  to,
  redirect,
}: {
  to: 'sign-in' | 'sign-up';
  redirect?: string | undefined;
}) {
  const href = authHref(to, redirect);
  return (
    <p className="auth-links">
      {to === 'sign-up' ? 'New here? ' : 'Already have an account? '}
      <Link href={href}>{to === 'sign-up' ? 'Sign up free' : 'Sign in'}</Link>
      {' · '}
      <Link href="/pricing">Pricing</Link>
      {' · '}
      <Link href="/docs">Docs</Link>
    </p>
  );
}
