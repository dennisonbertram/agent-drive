import { redirect } from 'next/navigation';
import { consoleUserId } from '@/src/console/auth';
import { PLANS } from '@/src/billing/policy';
import BillingClient from './billing-client';
import '../../../styles/account.css';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const userId = await consoleUserId();
  if (!userId) redirect('/sign-in');
  const plans = Object.entries(PLANS).map(([id, plan]) => ({
    id,
    baseCents: String(plan.baseCents),
    drives: String(plan.drives),
    storageBytes: String(plan.storageBytes),
    egressBytes: String(plan.egressBytes),
    operations: String(plan.operations),
  }));
  return <BillingClient key={userId} plans={plans} />;
}
