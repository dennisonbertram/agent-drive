import { handlePublicShareRequest } from '@/src/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const metadataOnly = new URL(request.url).searchParams.get('metadataOnly') === '1';
  return handlePublicShareRequest(id, metadataOnly);
}
