import { handleConsoleApiRequest } from '@/src/api/handler';
import { consoleReverified, consoleUserId } from '@/src/console/auth';

export const runtime = 'nodejs';

async function handle(request: Request) {
  const userId = await consoleUserId();
  return handleConsoleApiRequest(request, userId, userId ? await consoleReverified() : false);
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}

export function PATCH(request: Request) {
  return handle(request);
}

export function DELETE(request: Request) {
  return handle(request);
}
