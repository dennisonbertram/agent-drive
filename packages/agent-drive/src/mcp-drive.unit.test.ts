import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { AgentDriveClient } from './client.js';
import { createMcpServer } from './mcp.js';
import { resolveDriveId } from './config.js';

async function callList(
  resolve: Parameters<typeof createMcpServer>[1],
  args: Record<string, unknown>,
) {
  const seen: string[] = [];
  const stub = {
    list: async (drive: string) => {
      seen.push(drive);
      return { files: [] };
    },
    browse: async (drive: string, options: unknown) => {
      seen.push(`${drive} ${JSON.stringify(options)}`);
      return { items: [], nextCursor: null };
    },
  } as unknown as AgentDriveClient;
  const server = createMcpServer(stub, resolve);
  const client = new Client({ name: 'drive-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const result = (await client.callTool({ name: 'list', arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    return { seen, result };
  } finally {
    await client.close();
    await server.close();
  }
}

const api = 'http://127.0.0.1:3000/api';
const one = { driveKeys: { d1: 'k' }, driveKeyOrigins: { d1: 'http://127.0.0.1:3000' } };
const two = {
  driveKeys: { d1: 'k', d2: 'k' },
  driveKeyOrigins: { d1: 'http://127.0.0.1:3000', d2: 'http://127.0.0.1:3000' },
};

describe('MCP driveId default', () => {
  it('uses the only configured drive when driveId is omitted', async () => {
    const { seen, result } = await callList((id) => resolveDriveId(id, one, api), {});
    expect(result.isError).not.toBe(true);
    expect(seen).toEqual(['d1']);
  });
  it('keeps an explicit driveId', async () => {
    const { seen } = await callList((id) => resolveDriveId(id, one, api), { driveId: 'other' });
    expect(seen).toEqual(['other']);
  });
  it('lists configured ids when several drives exist', async () => {
    const { seen, result } = await callList((id) => resolveDriveId(id, two, api), {});
    expect(seen).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('d1, d2');
    expect(result.content[0]!.text).toContain('driveId');
  });
  it('list without folder/sort keeps calling plain list; with them it calls browse', async () => {
    const plain = await callList((id) => resolveDriveId(id, one, api), { prefix: '/a' });
    expect(plain.seen).toEqual(['d1']);
    const folder = await callList((id) => resolveDriveId(id, one, api), {
      folder: '/reports',
      sort: 'modified',
      limit: 5,
    });
    expect(folder.seen).toEqual([
      'd1 {"folder":"/reports","sort":"modified","limit":5,"filters":{}}',
    ]);
    const flat = await callList((id) => resolveDriveId(id, one, api), {
      sort: 'modified',
      prefix: '/a',
    });
    expect(flat.seen).toEqual(['d1 {"prefix":"/a","sort":"modified","filters":{}}']);
    const explicitPath = await callList((id) => resolveDriveId(id, one, api), {
      sort: 'path',
      prefix: '/a',
    });
    expect(explicitPath.seen).toEqual(['d1']);
    const both = await callList((id) => resolveDriveId(id, one, api), {
      folder: '/a',
      prefix: '/b',
    });
    expect(both.result.isError).toBe(true);
    const bad = await callList((id) => resolveDriveId(id, one, api), { sort: 'size' });
    expect(bad.result.isError).toBe(true);
  });
});

describe('MCP server identity', () => {
  it('reports the package version, not a placeholder', async () => {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
    const server = createMcpServer({} as AgentDriveClient);
    const client = new Client({ name: 'version-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      expect(version).not.toBe('0.0.0');
      expect(client.getServerVersion()?.version).toBe(version);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
