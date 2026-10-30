import { getPool } from '../db/client';
import { runDeletionMaintenance } from './deletion';

try {
  await runDeletionMaintenance();
} catch {
  console.error('Deletion maintenance failed.');
  process.exitCode = 1;
} finally {
  await getPool()
    .end()
    .catch(() => undefined);
}
