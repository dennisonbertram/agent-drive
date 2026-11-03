import { timingSafeEqual } from 'node:crypto';
import { runDeletionMaintenance } from '@/src/api/deletion';
import { cleanupAllExpiredUploads } from '@/src/api/upload-cleanup';
import { runBillingMaintenance } from '@/src/billing/maintenance';

export const runtime = 'nodejs';
export const maxDuration = 300;

type JobResult = 'ok' | 'failed';

const noStore = { 'Cache-Control': 'no-store' };

function authorized(request: Request, secret: string) {
  const authorization = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorization);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return Response.json(
      { error: 'Cron secret is not configured.' },
      { status: 503, headers: noStore },
    );

  if (!authorized(request, secret))
    return Response.json({ error: 'Unauthorized.' }, { status: 401, headers: noStore });

  const job = new URL(request.url).searchParams.get('job');
  if (job !== 'cleanup' && job !== 'billing')
    return Response.json({ error: 'Unknown maintenance job.' }, { status: 400, headers: noStore });

  const results: Record<string, JobResult> = {};
  if (job === 'cleanup') {
    try {
      await runDeletionMaintenance();
      results.deletion = 'ok';
    } catch {
      console.error('Deletion maintenance failed.');
      results.deletion = 'failed';
    }

    try {
      await cleanupAllExpiredUploads();
      results.uploads = 'ok';
    } catch {
      console.error('Expired upload cleanup failed.');
      results.uploads = 'failed';
    }
  } else {
    try {
      await runBillingMaintenance();
      results.billing = 'ok';
    } catch {
      console.error('Billing maintenance failed.');
      results.billing = 'failed';
    }
  }

  const failed = Object.values(results).includes('failed');
  return Response.json({ job, results }, { status: failed ? 500 : 200, headers: noStore });
}
