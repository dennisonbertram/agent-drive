import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkKeysConfigured, isClerkConsolePage } from './src/console/clerk-config';

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
  if (!configured) return NextResponse.next();
  return clerkProxy(request, event);
}

export const config = {
  matcher: ['/console/:path*', '/sign-in/:path*', '/sign-up/:path*', '/api/console/:path*'],
};
