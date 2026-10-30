import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkKeysConfigured, isClerkConsolePage } from './src/console/clerk-config';
import { shareTransportAllowed } from './src/share/transport';

const configured =
  process.env.AGENT_DRIVE_TEST_AUTH !== '1' &&
  clerkKeysConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, process.env.CLERK_SECRET_KEY);

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (isClerkConsolePage(request.nextUrl.pathname)) {
    await auth.protect();
  }
  return NextResponse.next();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;
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
    '/console/:path*',
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/api/console/:path*',
    '/s/:path*',
    '/api/shares/:path*',
  ],
};
