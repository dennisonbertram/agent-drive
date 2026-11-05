import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/app/brand-mark';
import { clerkConfigured, consoleUserId } from '@/src/console/auth';
import Connect from './connect';

export const dynamic = 'force-dynamic';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  const initialCode = typeof code === 'string' ? code : '';
  const userId = await consoleUserId();
  if (!userId) {
    const back = `/connect${initialCode ? `?code=${encodeURIComponent(initialCode)}` : ''}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }
  // Only the signed-in user's own email is read; test auth has no email.
  const account = clerkConfigured()
    ? ((await currentUser())?.primaryEmailAddress?.emailAddress ?? 'Signed-in account')
    : 'Local test session';
  return (
    <main className="connect-shell">
      <BrandMark />
      <Connect key={userId} initialCode={initialCode} account={account} />
    </main>
  );
}
