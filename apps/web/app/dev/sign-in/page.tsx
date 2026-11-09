import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  issueTestSessionCookie,
  testAuthEnabled,
  testSessionCookieName,
} from '../../../src/console/auth';
import { defaultDevUserId, devSignInAllowed, parseDevUserId } from './guard';

export const dynamic = 'force-dynamic';

async function guard() {
  const host = (await headers()).get('host');
  if (!devSignInAllowed({ nodeEnv: process.env.NODE_ENV, testAuth: testAuthEnabled(), host }))
    notFound();
}

async function signIn(formData: FormData) {
  'use server';
  await guard();
  const raw = formData.get('userId');
  const userId = parseDevUserId(typeof raw === 'string' ? raw : null);
  if (!userId) redirect('/dev/sign-in?error=1');
  const session = issueTestSessionCookie(userId);
  (await cookies()).set(testSessionCookieName, session.value, {
    maxAge: 3600,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  redirect('/console');
}

export default async function DevSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await guard();
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Dev sign-in</h1>
      <p>Local development only. Sets a one-hour test session cookie.</p>
      <form action={signIn}>
        <label>
          Test user ID{' '}
          <input name="userId" defaultValue={defaultDevUserId} pattern="e2e_[a-zA-Z0-9_\-]+" />
        </label>
        {error ? <p role="alert">User ID must match e2e_ followed by letters, digits, _ or -.</p> : null}
        <p>
          <button type="submit">Sign in as test user</button>
        </p>
      </form>
    </main>
  );
}
