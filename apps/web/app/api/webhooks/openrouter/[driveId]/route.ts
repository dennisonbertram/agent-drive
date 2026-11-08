import {
  authorizeOpenRouterWebhook,
  ingestOpenRouterTrace,
} from '../../../../../src/api/trace-webhook';
import { responseForError } from '../../../../../src/api/errors';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024;

function tooLarge() {
  return Response.json(
    { error: { code: 'validation_error', message: 'Webhook body is too large.' } },
    { status: 413, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ driveId: string }> }) {
  // HTTPS and the token are checked before the body is read.
  let driveId: string;
  let auth: Awaited<ReturnType<typeof authorizeOpenRouterWebhook>>;
  const url = new URL(request.url);
  try {
    driveId = (await context.params).driveId;
    auth = await authorizeOpenRouterWebhook({ url, headers: request.headers, driveId });
  } catch (error) {
    await request.body?.cancel().catch(() => undefined);
    return responseForError(error);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await ingestOpenRouterTrace({ url, headers: request.headers, bytes, driveId, auth });
  } catch (error) {
    return responseForError(error);
  }
}
