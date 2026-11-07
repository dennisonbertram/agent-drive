import { publicOrigin } from '@/src/content/origin';
import { getMarkdown, htmlPath } from '@/src/content/site';

// Reached through the rewrites in next.config.ts: /page.md and `Accept: text/markdown` on /page.
export async function GET(request: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const origin = publicOrigin(request.headers);
  const body = getMarkdown(slug, origin);
  if (body === null) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      vary: 'Accept',
      link: `<${origin}${htmlPath(slug.join('/'))}>; rel="canonical"`,
      'cache-control': 'public, max-age=300',
    },
  });
}
