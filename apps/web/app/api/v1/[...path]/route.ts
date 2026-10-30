import { handleApiRequest } from '@/src/api/handler';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, _context: RouteContext) {
  void _context;
  return handleApiRequest(request);
}

export async function POST(request: Request, _context: RouteContext) {
  void _context;
  return handleApiRequest(request);
}

export async function DELETE(request: Request, _context: RouteContext) {
  void _context;
  return handleApiRequest(request);
}
