import { handleConsoleApiRequest } from '@/src/api/handler';
import { consoleUserId } from '@/src/console/auth';

export const runtime = 'nodejs';

async function handle(request: Request) {
  return handleConsoleApiRequest(request, await consoleUserId());
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
