import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runDeletionMaintenance,
  cleanupAllExpiredUploads,
  cleanupDeviceAuthorizations,
  runBillingMaintenance,
} = vi.hoisted(() => ({
  runDeletionMaintenance: vi.fn(),
  cleanupAllExpiredUploads: vi.fn(),
  cleanupDeviceAuthorizations: vi.fn(),
  runBillingMaintenance: vi.fn(),
}));

vi.mock('@/src/api/deletion', () => ({ runDeletionMaintenance }));
vi.mock('@/src/api/upload-cleanup', () => ({
  cleanupAllExpiredUploads,
  cleanupDeviceAuthorizations,
}));
vi.mock('@/src/billing/maintenance', () => ({ runBillingMaintenance }));

import { GET } from './route';

const secret = 'c'.repeat(32);

function request(job: string, authorization?: string) {
  return new Request(`http://localhost/api/cron/maintenance?job=${job}`, {
    headers: authorization ? { authorization } : {},
  });
}

describe('maintenance cron route', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('returns 503 without running jobs when the secret is missing', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request('cleanup', `Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(runDeletionMaintenance).not.toHaveBeenCalled();
    expect(cleanupAllExpiredUploads).not.toHaveBeenCalled();
    expect(runBillingMaintenance).not.toHaveBeenCalled();
  });

  it('returns 401 without running jobs for a wrong bearer token', async () => {
    const response = await GET(request('cleanup', `Bearer ${'d'.repeat(32)}`));

    expect(response.status).toBe(401);
    expect(runDeletionMaintenance).not.toHaveBeenCalled();
    expect(cleanupAllExpiredUploads).not.toHaveBeenCalled();
    expect(runBillingMaintenance).not.toHaveBeenCalled();
  });

  it('runs both cleanup jobs and not billing', async () => {
    const response = await GET(request('cleanup', `Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      job: 'cleanup',
      results: { deletion: 'ok', uploads: 'ok', deviceAuthorizations: 'ok' },
    });
    expect(runDeletionMaintenance).toHaveBeenCalledOnce();
    expect(cleanupAllExpiredUploads).toHaveBeenCalledOnce();
    expect(cleanupDeviceAuthorizations).toHaveBeenCalledOnce();
    expect(runBillingMaintenance).not.toHaveBeenCalled();
  });

  it('runs billing maintenance for the billing job', async () => {
    const response = await GET(request('billing', `Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: 'billing', results: { billing: 'ok' } });
    expect(runBillingMaintenance).toHaveBeenCalledOnce();
    expect(runDeletionMaintenance).not.toHaveBeenCalled();
    expect(cleanupAllExpiredUploads).not.toHaveBeenCalled();
  });

  it('continues to the second cleanup job when the first one fails', async () => {
    runDeletionMaintenance.mockRejectedValueOnce(new Error('private detail'));

    const response = await GET(request('cleanup', `Bearer ${secret}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      job: 'cleanup',
      results: { deletion: 'failed', uploads: 'ok', deviceAuthorizations: 'ok' },
    });
    expect(cleanupAllExpiredUploads).toHaveBeenCalledOnce();
  });

  it('returns 400 for an unknown job', async () => {
    const response = await GET(request('unknown', `Bearer ${secret}`));

    expect(response.status).toBe(400);
    expect(runDeletionMaintenance).not.toHaveBeenCalled();
    expect(cleanupAllExpiredUploads).not.toHaveBeenCalled();
    expect(runBillingMaintenance).not.toHaveBeenCalled();
  });
});
