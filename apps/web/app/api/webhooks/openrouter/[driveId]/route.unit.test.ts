import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ingestOpenRouterTrace, authorizeOpenRouterWebhook } = vi.hoisted(() => ({
  ingestOpenRouterTrace: vi.fn(),
  authorizeOpenRouterWebhook: vi.fn(),
}));
vi.mock('../../../../../src/api/trace-webhook', () => ({
  ingestOpenRouterTrace,
  authorizeOpenRouterWebhook,
}));

import { ApiError } from '../../../../../src/api/errors';
import { POST } from './route';

const driveId = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ driveId }) };
const call = (body: Uint8Array, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://agent-drive.test/api/webhooks/openrouter/${driveId}`, {
      method: 'POST',
      headers,
      body: body as BodyInit,
    }),
    context,
  );

describe('openrouter webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeOpenRouterWebhook.mockResolvedValue({ drive_id: driveId });
  });

  it('returns 413 above 4 MiB without calling the module', async () => {
    const response = await call(new Uint8Array(4 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('validation_error');
    expect(ingestOpenRouterTrace).not.toHaveBeenCalled();
  });

  it('passes the exact bytes and headers once', async () => {
    ingestOpenRouterTrace.mockResolvedValue(Response.json({ ok: true }, { status: 201 }));
    const bytes = new Uint8Array(1024).map((_, i) => i % 251);
    const response = await call(bytes, { authorization: 'Bearer x', 'x-test-connection': 'true' });
    expect(response.status).toBe(201);
    expect(ingestOpenRouterTrace).toHaveBeenCalledOnce();
    const arg = ingestOpenRouterTrace.mock.calls[0]![0];
    expect(Array.from(arg.bytes)).toEqual(Array.from(bytes));
    expect(arg.driveId).toBe(driveId);
    expect(arg.headers.get('authorization')).toBe('Bearer x');
    expect(arg.headers.get('x-test-connection')).toBe('true');
    expect(arg.url.protocol).toBe('https:');
  });

  it('rejects before reading the body when authorization fails', async () => {
    authorizeOpenRouterWebhook.mockRejectedValue(new ApiError('unauthorized', 'nope'));
    const pull = vi.fn();
    const body = new ReadableStream({ pull }, { highWaterMark: 0 });
    const response = await POST(
      new Request(`https://agent-drive.test/api/webhooks/openrouter/${driveId}`, {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
      context,
    );
    expect(response.status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
    expect(ingestOpenRouterTrace).not.toHaveBeenCalled();
  });

  it('maps a thrown ApiError to the standard error body', async () => {
    ingestOpenRouterTrace.mockRejectedValue(new ApiError('unauthorized', 'nope'));
    const response = await call(new Uint8Array(1));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'nope' } });
  });
});
