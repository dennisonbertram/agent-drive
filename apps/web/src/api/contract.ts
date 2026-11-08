export const API_CONTRACT = [
  'GET /api/v1/whoami',
  'GET|POST /api/v1/drives',
  'GET|POST /api/v1/agents',
  'GET|POST /api/v1/keys',
  'DELETE /api/v1/keys/:id',
  'GET /api/v1/device/:code',
  'POST /api/v1/device/:code/grant',
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
  'POST /api/v1/drives/:id/shares',
  'GET /api/v1/drives/:id/shares',
  'DELETE /api/v1/drives/:id/shares/:shareId',
  'GET /api/v1/drives/:id/trace-inbox',
  'GET /api/shares/:id',
  'GET /api/console/billing',
  'PATCH /api/console/billing/settings',
  'POST /api/console/billing/checkout',
  'POST /api/console/billing/portal',
  'GET /api/console/billing/statements',
  'GET|POST /api/console/drives/:id/trace-inbox',
  'GET|POST|DELETE /api/console/drives/:id/webhook-token',
  'POST /api/stripe/webhook',
  'POST /api/webhooks/openrouter/:driveId',
] as const;

export type ApiContract = (typeof API_CONTRACT)[number];

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type FileEventOperation = 'put' | 'copy' | 'restore' | 'move' | 'delete';

export type RecentFileEvent = {
  id: string;
  operation: FileEventOperation;
  path: string;
  previousPath: string | null;
  versionId: string | null;
  agentId: string;
  agentName: string | null;
  machineId: string | null;
  userId: string | null;
  createdAt: string;
};

export type RecentPage = Page<RecentFileEvent> & { latestCursor: string | null };
