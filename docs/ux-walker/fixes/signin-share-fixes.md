# Sign-in redirect and share logo fixes

Branch: ux-walker/signin-share-fixes (not pushed)

## Changes

- F-004-01 / F-003-03: apps/web/proxy.ts now calls `clerkMiddleware(handler, { signInUrl: '/sign-in', signUpUrl: '/sign-up' })`. `auth.protect()` then redirects signed-out /console visits to the app's own /sign-in, with the return URL preserved by Clerk. Source: installed @clerk/nextjs 7.9.22 `ClerkMiddlewareOptions` (extends AuthenticateRequestOptions, which has signInUrl/signUpUrl) and Clerk docs via ctx7 (/clerk/clerk-docs): "passing a `signInUrl` option to the middleware".
- F-006-02: apps/web/app/s/[id]/share-client.tsx brand mark text "ad" changed to "a/", same markup as the other pages (span.brand-mark). No shared component exists.

## Checks

- tsc --noEmit: pass. eslint and prettier on changed files: pass. Unit vitest: 21 files, 77 tests pass.
- Playwright e2e: not run (Postgres 15432 / MinIO 19000 not reachable).
- Not verified: the actual Clerk redirect (e2e uses test-auth mode). Verify after deployment by visiting /console signed out.

## Not fixed

- Share error-ordering (issue #30). No new automated test was added for the logo text or the redirect.
