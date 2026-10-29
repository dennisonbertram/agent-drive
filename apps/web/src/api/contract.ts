export const API_CONTRACT = [
  'GET /api/v1/whoami',
  'GET|POST /api/v1/drives',
  'GET|POST /api/v1/agents',
  'GET|POST /api/v1/keys',
  'DELETE /api/v1/keys/:id',
  'POST /api/v1/drives/:id/put',
  'POST /api/v1/drives/:id/commit',
  'GET /api/v1/drives/:id/get',
  'GET /api/v1/drives/:id/list',
  'POST /api/v1/drives/:id/move',
  'POST /api/v1/drives/:id/copy',
  'POST /api/v1/drives/:id/delete',
  'POST /api/v1/drives/:id/restore',
  'GET /api/v1/drives/:id/versions',
  'GET /api/v1/drives/:id/recent',
  'GET /api/v1/drives/:id/search',
] as const;

export type ApiContract = (typeof API_CONTRACT)[number];
