import { getPool } from '../db/client';
import { runBillingMaintenance } from './maintenance';

try {
  await runBillingMaintenance();
} catch {
  console.error('Billing maintenance failed.');
  process.exitCode = 1;
} finally {
  await getPool()
    .end()
    .catch(() => undefined);
}
