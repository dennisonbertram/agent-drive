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
    expect(body).toContain('agent-drive check');
    expect(body).toContain('check ok');
    expect(body).toContain('no usable drive key');
    expect(body).toContain('Do not use');
    expect(body).not.toContain('agent-drive whoami');
    expect(body).toContain('claude mcp add agent-drive -- agent-drive mcp');
    expect(body).toContain('[mcp_servers.agent-drive]');
    expect(body).toContain('default_tools_approval_mode = "approve"');
    expect(body).toContain('Back up your credentials');
    expect(body).toContain('agent-drive credentials export --to');
    expect(body).toContain('agent-drive credentials export --stdout |');
    expect(body).toContain('<your secret store> && agent-drive credentials confirm');
    expect(body).toContain(
      'gh secret set AGENT_DRIVE_CREDENTIALS && agent-drive credentials confirm',
    );
    expect(body).toContain('gh secret set AGENT_DRIVE_CREDENTIALS');
    expect(body).toContain('vercel env add AGENT_DRIVE_CREDENTIALS production');
    expect(body).toContain('agent-drive skill install');
    expect(body).toContain('agent-drive skill install --target <dir>');
    expect(body).toContain('~/.claude/skills or ~/.codex/skills');
    expect(body).toContain('## Sandboxes');
    expect(body).toContain('## Several agents on one drive');
    expect(body).toContain('agent-drive credentials issue --name <agent> --write-path');
    expect(body).toContain('Never copy your own bundle into');
    expect(body).toContain('agent-drive grant <its code> --write-path <its folder>');
    expect(body).toContain('Which handoff when');
    expect(body).toContain('Never put secrets in');
    expect(body).toContain('Never store a drive key in the drive it unlocks');
    expect(body.indexOf('credentials export')).toBeLessThan(body.indexOf('agent-drive check'));
  });

  it('adds --api to login commands for a non-default origin only', async () => {
    const other = await (await GET(new Request('http://localhost:3100/llms.txt'))).text();
    expect(other).toContain('login --name "<your agent name>" --api http://localhost:3100/api');
    expect(other).toContain('npx -y http://localhost:3100/cli/agent-drive.tgz login --name');
    expect(other).toContain('agent-drive login --api http://localhost:3100/api` on the new');
    for (const line of other.split('\n').filter((l) => /agent-drive login|\blogin --name/u.test(l)))
      expect(line, line).toContain('--api http://localhost:3100/api');
    const prod = await (await GET(new Request('https://agentdrive.xyz/llms.txt'))).text();
    expect(prod).not.toContain('--api');
  });
});
