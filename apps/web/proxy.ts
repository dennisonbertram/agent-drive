import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkKeysConfigured, isClerkConsolePage } from './src/console/clerk-config';
import { prefersMarkdown } from './src/content/negotiate';
import { shareTransportAllowed } from './src/share/transport';

// Public pages with a Markdown twin. These never touch Clerk or auth().
const TWIN = /^\/(?:pricing|privacy|terms|docs(?:\/[^/]+)?|compare(?:\/[^/]+)?)?$/;

const configured =
  process.env.AGENT_DRIVE_TEST_AUTH !== '1' &&
  clerkKeysConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, process.env.CLERK_SECRET_KEY);

const clerkProxy = clerkMiddleware(
  async (auth, request) => {
    if (isClerkConsolePage(request.nextUrl.pathname)) {
      await auth.protect();
    }
    return NextResponse.next();
  },
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;
  if (TWIN.test(pathname)) {
    if (!prefersMarkdown(request.headers.get('accept'))) return NextResponse.next();
    const slug = pathname === '/' ? '/index' : pathname;
    return NextResponse.rewrite(new URL(`/md${slug}`, request.url));
  }
  if (
    pathname === '/s' ||
    pathname.startsWith('/s/') ||
    pathname === '/api/shares' ||
    pathname.startsWith('/api/shares/')
  ) {
    if (!shareTransportAllowed(request.nextUrl, process.env.NODE_ENV)) {
      return new NextResponse('HTTPS is required for share links.', {
        status: 403,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return NextResponse.next();
  }
  if (!configured) return NextResponse.next();
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    '/',
    '/pricing',
    '/privacy',
    '/terms',
    '/docs',
    '/docs/:slug',
    '/compare',
    '/compare/:slug',
    '/console/:path*',
    '/connect/:path*',
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/api/console/:path*',
    '/s/:path*',
    '/api/shares/:path*',
  ],
};
