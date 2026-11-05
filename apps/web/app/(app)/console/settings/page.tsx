import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { consoleUserId } from '@/src/console/auth';
import SettingsClient from './settings-client';
import '../../../styles/account.css';

export const metadata: Metadata = { title: 'Activity & deletion | Agent Drive' };

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!(await consoleUserId())) redirect('/sign-in');
  return <SettingsClient />;
}
