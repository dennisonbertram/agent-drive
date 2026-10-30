import { getPool } from '../db/client';
import { cleanupAllExpiredUploads } from './upload-cleanup';

async function main() {
  try {
    const removed = await cleanupAllExpiredUploads();
    process.stdout.write(`Removed ${removed} expired upload intents.\n`);
  } catch {
    process.stderr.write('Expired upload cleanup failed.\n');
    process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}

void main();
