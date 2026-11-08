import { describe, expect, it } from 'vitest';
import { auditLabel } from '../console/audit-labels';
import { actionFor, consoleReadActions, consoleRouteAllowed } from './handler';

const ID = '11111111-1111-1111-1111-111111111111';
const SID = 'a'.repeat(22);
const firsts = [
  'device',
  'deletions',
  'audit',
  'account',
  'billing',
  'session',
  'usage',
  'whoami',
  'drives',
  'agents',
  'keys',
  'account-key',
];
const seconds = [ID, 'statements', 'settings', 'checkout', 'portal', 'slots'];
const thirds = [
  'approve',
  'deny',
  'revoke',
  'shares',
  'key-backup',
  'get',
  'list',
  'versions',
  'recent',
  'search',
  'trash',
  'delete',
  'restore',
  'move',
  'copy',
  'put',
  'commit',
  'metadata',
  'head',
  'account-key',
  'trace-inbox',
  'webhook-token',
];
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const shapes = firsts.flatMap((a) => [
  [a],
  ...seconds.flatMap((b) => [
    [a, b],
    ...thirds.flatMap((c) => [
      [a, b, c],
      [a, b, c, SID],
    ]),
  ]),
]);
const allowed = methods.flatMap((m) =>
  shapes.filter((p) => consoleRouteAllowed(m, p)).map((p) => [m, p] as const),
);

describe('console actions', () => {
  it('enumerates a meaningful set of console routes', () => {
    expect(allowed.length).toBeGreaterThan(30);
  });
  it('names every console-allowed route with a label', () => {
    for (const [m, p] of allowed) {
      const action = actionFor(m, p);
      expect(action, `${m} ${p.join('/')}`).not.toBe('unknown');
      expect(auditLabel(action), action).not.toBe('Other request');
    }
  });
  it('allows exactly the trace inbox and webhook token routes', () => {
    const inbox = ['drives', ID, 'trace-inbox'];
    const token = ['drives', ID, 'webhook-token'];
    for (const m of ['GET', 'POST']) expect(consoleRouteAllowed(m, inbox)).toBe(true);
    for (const m of ['PUT', 'PATCH', 'DELETE']) expect(consoleRouteAllowed(m, inbox)).toBe(false);
    for (const m of ['GET', 'POST', 'DELETE']) expect(consoleRouteAllowed(m, token)).toBe(true);
    for (const m of ['PUT', 'PATCH']) expect(consoleRouteAllowed(m, token)).toBe(false);
    expect(actionFor('GET', inbox, true)).toBe('drive.trace_inbox.read');
    expect(actionFor('GET', inbox)).toBe('drive.trace_inbox.read');
    expect(actionFor('POST', inbox)).toBe('console.drive.trace_inbox.create');
    expect(actionFor('GET', token)).toBe('console.drive.webhook_token.read');
    expect(actionFor('POST', token)).toBe('console.drive.webhook_token.create');
    expect(actionFor('DELETE', token)).toBe('console.drive.webhook_token.revoke');
  });
  it('consoleReads=0 hides every console GET read and keeps writes', () => {
    // Mirrors the SQL filter in the audit endpoint: LIKE '%.list', LIKE '%.read', or consoleReadActions.
    const hidden = (a: string) => /\.(list|read)$/u.test(a) || consoleReadActions.includes(a);
    for (const [m, p] of allowed) {
      const action = actionFor(m, p);
      if (p[0] === 'audit') continue; // the audit page itself is listed as console.audit.list
      expect(hidden(action), `${m} ${p.join('/')} -> ${action}`).toBe(m === 'GET');
    }
  });
});
