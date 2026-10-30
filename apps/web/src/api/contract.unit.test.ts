import { describe, expect, it } from 'vitest';
import { API_CONTRACT } from './contract';

describe('core API contract', () => {
  it('keeps the Phase 1 route surface stable', () => {
    expect(API_CONTRACT).toMatchInlineSnapshot(`
      [
        "GET /api/v1/whoami",
        "GET|POST /api/v1/drives",
        "GET|POST /api/v1/agents",
        "GET|POST /api/v1/keys",
        "DELETE /api/v1/keys/:id",
        "POST /api/v1/drives/:id/put",
        "POST /api/v1/drives/:id/commit",
        "GET /api/v1/drives/:id/get",
        "GET /api/v1/drives/:id/list",
        "POST /api/v1/drives/:id/move",
        "POST /api/v1/drives/:id/copy",
        "POST /api/v1/drives/:id/delete",
        "POST /api/v1/drives/:id/restore",
        "GET /api/v1/drives/:id/versions",
        "GET /api/v1/drives/:id/recent",
        "GET /api/v1/drives/:id/search",
        "POST /api/v1/drives/:id/shares",
        "GET /api/v1/drives/:id/shares",
        "DELETE /api/v1/drives/:id/shares/:shareId",
        "GET /api/shares/:id",
      ]
    `);
  });
});
