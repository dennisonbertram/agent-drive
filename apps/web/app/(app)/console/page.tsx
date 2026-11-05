import '../../styles/console-panels.css';
import { redirect } from 'next/navigation';
import { clerkConfigured, consoleUserId } from '@/src/console/auth';
import Console from './console';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const userId = await consoleUserId();
  if (!userId) redirect('/sign-in');
  return <Console key={userId} clerkEnabled={clerkConfigured()} />;
}
