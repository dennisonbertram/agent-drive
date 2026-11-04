import { handleOAuthRequest } from '@/src/api/device';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return handleOAuthRequest(request);
}

export function GET(request: Request) {
  return handleOAuthRequest(request);
}
