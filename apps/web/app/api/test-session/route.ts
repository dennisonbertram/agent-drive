import { createHash, timingSafeEqual } from 'node:crypto';
import {
  issueTestSessionCookie,
  testAuthEnabled,
  testSessionCookieName,
} from '../../../src/console/auth';

export const runtime = 'nodejs';

function secretsEqual(provided: string, expected: string) {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function responseError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!testAuthEnabled()) return responseError(404, 'Not found.');
  const hostname = new URL(request.url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') return responseError(404, 'Not found.');

  const expected = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!expected || !match || !secretsEqual(match[1]!, expected))
    return responseError(401, 'The test-session authorization is invalid.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return responseError(400, 'The request body must be valid JSON.');
  }
  const userId =
    typeof body === 'object' && body !== null && 'userId' in body && typeof body.userId === 'string'
      ? body.userId
      : undefined;
  if (!userId || !/^e2e_[a-zA-Z0-9_-]+$/.test(userId))
    return responseError(400, 'userId must be a valid test identity.');

  const session = issueTestSessionCookie(userId);
  return Response.json(
    { userId },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `${testSessionCookieName}=${session.value}; Max-Age=3600; HttpOnly; SameSite=Lax; Path=/`,
      },
    },
  );
}
