import Link from 'next/link';
import { redirect } from 'next/navigation';
import { consoleUserId } from '@/src/console/auth';
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
  return (
    <main className="connect-shell">
      <Link href="/" className="brand">
        <span className="brand-mark">a/</span> agent drive
      </Link>
      <Connect key={userId} initialCode={initialCode} />
    </main>
  );
}
