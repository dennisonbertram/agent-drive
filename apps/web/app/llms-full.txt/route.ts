import { publicOrigin } from '@/src/content/origin';
import { llmsFull } from '@/src/content/site';

export function GET(request: Request) {
  return new Response(llmsFull(publicOrigin(request.headers)), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
