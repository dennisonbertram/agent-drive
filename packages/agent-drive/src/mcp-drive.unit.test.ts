import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function callTool(
  clientValue: AgentDriveClient,
  name: string,
  args: Record<string, unknown>,
) {
  const server = createMcpServer(clientValue);
  const client = new Client({ name: 'stream-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    return (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
  } finally {
    await client.close();
    await server.close();
  }
}

const fileVersion = {
  id: 'version-1',
  path: '/file',
  ciphertextSize: 42,
  wrappedKey: 'wrapped',
  agentId: 'agent',
  machineId: null,
  userId: null,
  tags: [],
  description: null,
  createdAt: '2026-01-01T00:00:00Z',
};

async function* chunks(...values: Uint8Array[]) {
  for (const value of values) yield value;
}

async function* brokenChunks() {
  yield new Uint8Array([1, 2]);
  throw new Error('truncated test stream');
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

describe('MCP streaming file tools', () => {
  it('bounds inline bytes and passes the size cap before a transfer is opened', async () => {
    let options: Record<string, unknown> | undefined;
    let cancelled = false;
    const stub = {
      getStream: async (_drive: string, _path: string, received: Record<string, unknown>) => {
        options = received;
        return {
          version: fileVersion,
          plaintextBytes: 3,
          plaintext: chunks(new TextEncoder().encode('ab'), new TextEncoder().encode('c')),
          cancel: async () => {
            cancelled = true;
          },
        };
      },
    } as unknown as AgentDriveClient;
    const ok = await callTool(stub, 'get', { driveId: 'd', path: '/file' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0]!.text).data.text).toBe('abc');
    expect(options?.maxPlaintextBytes).toBe(64 * 1024);

    const oversized = {
      getStream: async () => ({
        version: fileVersion,
        plaintextBytes: 64 * 1024 + 1,
        plaintext: chunks(new Uint8Array(64 * 1024 + 1)),
        cancel: async () => {
          cancelled = true;
        },
      }),
    } as unknown as AgentDriveClient;
    const denied = await callTool(oversized, 'get', { driveId: 'd', path: '/file' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toContain('download tool');
    expect(cancelled).toBe(true);
  });

  it('streams local uploads and atomically writes downloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-drive-mcp-stream-'));
    try {
      const localInput = join(directory, 'input.bin');
      const localOutput = join(directory, 'output.bin');
      const data = new Uint8Array([0, 1, 2, 127, 255]);
      await writeFile(localInput, data);
      let uploaded = new Uint8Array();
      const stub = {
        putStream: async (
          _drive: string,
          path: string,
          source: AsyncIterable<Uint8Array>,
          plaintextBytes: number,
        ) => {
          expect(path).toBe('/remote.bin');
          expect(plaintextBytes).toBe(data.byteLength);
          const parts: Uint8Array[] = [];
          for await (const part of source) parts.push(part);
          uploaded = Buffer.concat(parts);
          return { ...fileVersion, path };
        },
        getStream: async () => ({
          version: fileVersion,
          plaintextBytes: data.byteLength,
          plaintext: chunks(data.slice(0, 2), data.slice(2)),
          cancel: async () => {},
        }),
      } as unknown as AgentDriveClient;
      const put = await callTool(stub, 'put', {
        driveId: 'd',
        path: '/remote.bin',
        localPath: localInput,
      });
      expect(put.isError).not.toBe(true);
      expect(Array.from(uploaded)).toEqual(Array.from(data));

      const download = await callTool(stub, 'download', {
        driveId: 'd',
        path: '/remote.bin',
        outputPath: localOutput,
      });
      expect(download.isError).not.toBe(true);
      expect(Array.from(await readFile(localOutput))).toEqual(Array.from(data));

      const failedOutput = join(directory, 'failed.bin');
      const broken = {
        getStream: async () => ({
          version: fileVersion,
          plaintextBytes: 5,
          plaintext: brokenChunks(),
          cancel: async () => {},
        }),
      } as unknown as AgentDriveClient;
      const failed = await callTool(broken, 'download', {
        driveId: 'd',
        path: '/remote.bin',
        outputPath: failedOutput,
      });
      expect(failed.isError).toBe(true);
      await expect(readFile(failedOutput)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
