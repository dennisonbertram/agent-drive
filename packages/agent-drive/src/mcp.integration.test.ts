import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

describe('MCP SDK infrastructure scaffold only (product tools pending Phase 3)', () => {
  it('initializes an in-memory client and server handshake', async () => {
    const server = new McpServer({
      name: 'agent-drive-scaffold',
      version: '0.0.0',
    });
    const client = new Client({
      name: 'agent-drive-scaffold-test',
      version: '0.0.0',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerVersion()?.name).toBe('agent-drive-scaffold');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
