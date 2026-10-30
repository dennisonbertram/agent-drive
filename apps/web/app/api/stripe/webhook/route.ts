import { processStripeWebhook } from '@/src/billing/providers';
import { responseForError } from '@/src/api/errors';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json(
      { error: { code: 'validation_error', message: 'Webhook body is required.' } },
      { status: 400 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) {
      await reader.cancel();
      return Response.json(
        { error: { code: 'validation_error', message: 'Webhook body is too large.' } },
        { status: 400 },
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);
  try {
    const result = await processStripeWebhook(body, request.headers.get('stripe-signature'));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return responseForError(error);
  }
}
