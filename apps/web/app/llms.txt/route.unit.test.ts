import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /llms.txt', () => {
  it('serves plain text with the origin-specific instruction and install URL', async () => {
    const res = await GET(new Request('https://example.test/llms.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('Set up Agent Drive: https://example.test/llms.txt');
    expect(body).toContain('npm install -g https://example.test/cli/agent-drive.tgz');
    expect(body).toContain('npx -y https://example.test/cli/agent-drive.tgz');
    expect(body).toContain('agent-drive login --name');
    expect(body).toContain('claude mcp add agent-drive -- agent-drive mcp');
    expect(body).toContain('[mcp_servers.agent-drive]');
  });
});
