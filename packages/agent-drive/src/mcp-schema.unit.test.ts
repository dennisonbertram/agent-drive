import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { AgentDriveClient } from './client.js';
import { createMcpServer } from './mcp.js';

describe('MCP tool contract', () => {
  it('keeps the sorted tool names, descriptions, schemas, and annotations stable', async () => {
    const server = createMcpServer(
      new AgentDriveClient({
        apiUrl: 'http://127.0.0.1:3000',
        apiKey: 'schema-test',
        driveKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    );
    const client = new Client({ name: 'agent-drive-schema-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(
        tools.tools
          .map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            annotations,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toMatchSnapshot();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
