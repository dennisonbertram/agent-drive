import { redirect } from 'next/navigation';
import { consoleUserId } from '@/src/console/auth';
import SettingsClient from './settings-client';
import '../billing/billing.css';
import './settings.css';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!(await consoleUserId())) redirect('/sign-in');
  return <SettingsClient />;
}
