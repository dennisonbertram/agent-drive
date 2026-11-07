import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditLabel, errorLabel } from './audit-labels';

describe('auditLabel', () => {
  it('names every action the handler can record', () => {
    const source = readFileSync(resolve(__dirname, '../api/handler.ts'), 'utf8');
    const block = source.slice(
      source.indexOf('function actionFor('),
      source.indexOf('async function audit('),
    );
    const names = new Set([...block.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/gu)].map((m) => m[1]!));
    for (const n of ['share.access', 'share.create', 'share.list']) names.add(n);
    expect(names.size).toBeGreaterThan(30);
    for (const name of names) expect(auditLabel(name), name).not.toBe('Other request');
  });
  it('maps unknown and unmapped names to Other request', () => {
    expect(auditLabel('unknown')).toBe('Other request');
    expect(auditLabel('something.else')).toBe('Other request');
    expect(auditLabel('drive.put')).toBe('Uploaded a file');
  });
});

describe('errorLabel', () => {
  it('names every ErrorCode the API can emit', () => {
    const source = readFileSync(resolve(__dirname, '../api/errors.ts'), 'utf8');
    const union = source.slice(
      source.indexOf('export type ErrorCode'),
      source.indexOf('const statuses'),
    );
    const codes = [...union.matchAll(/'([a-z_]+)'/gu)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(8);
    for (const code of codes) expect(errorLabel(code), code).not.toBe('error');
  });
  it('maps known codes and falls back to error', () => {
    expect(errorLabel('share_revoked')).toBe('link was revoked');
    expect(errorLabel('not_found')).toBe('not found');
    expect(errorLabel('permission_denied')).toBe('not allowed');
    expect(errorLabel('quota_exceeded')).toBe('over quota');
    expect(errorLabel('weird')).toBe('error');
    expect(errorLabel(null)).toBe('error');
  });
});
