import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareTransportAllowed } from './transport';

const clerkMock = vi.hoisted(() => {
  const handler = vi.fn(() => new Response('Clerk proxy invoked', { status: 418 }));
  return { handler, middleware: vi.fn(() => handler) };
});

vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: clerkMock.middleware }));

describe('share transport', () => {
  it('allows HTTPS in production and rejects production HTTP, including localhost', () => {
    expect(shareTransportAllowed(new URL('https://example.test/s/id'), 'production')).toBe(true);
    expect(shareTransportAllowed(new URL('http://localhost/s/id'), 'production')).toBe(false);
  });

  it('rejects remote HTTP and allows only loopback HTTP outside production', () => {
    expect(shareTransportAllowed(new URL('http://example.test/s/id'), 'development')).toBe(false);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(shareTransportAllowed(new URL(`http://${host}/s/id`), 'development')).toBe(true);
    }
    expect(shareTransportAllowed(new URL('ftp://localhost/s/id'), 'development')).toBe(false);
  });
});

describe('share proxy transport branch', () => {
  beforeEach(() => {
    vi.resetModules();
    clerkMock.handler.mockClear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AGENT_DRIVE_TEST_AUTH', '0');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_live-value');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_live-value');
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(['/s/share-id', '/api/shares/share-id'])(
    'bypasses Clerk for allowed %s',
    async (path) => {
      const { default: proxy, config } = await import('../../proxy');
      expect(config.matcher).toContain(path.startsWith('/s') ? '/s/:path*' : '/api/shares/:path*');
      const response = await proxy(new NextRequest(`https://example.test${path}`), {} as never);
      if (!response) throw new Error('Proxy did not return a response.');
      expect(response.status).toBe(200);
      expect(clerkMock.handler).not.toHaveBeenCalled();
    },
  );

  it('returns the specified no-store 403 for insecure share requests without calling Clerk', async () => {
    const { default: proxy } = await import('../../proxy');
    const response = await proxy(new NextRequest('http://example.test/s/share-id'), {} as never);
    if (!response) throw new Error('Proxy did not return a response.');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('HTTPS is required for share links.');
    expect(clerkMock.handler).not.toHaveBeenCalled();
  });
});
