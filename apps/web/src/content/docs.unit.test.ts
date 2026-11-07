import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './docs.allowlist.json';
import sources from './docs.generated.json';

const docsDir = path.join(__dirname, '..', '..', '..', '..', 'docs');

describe('embedded public docs', () => {
  it('embeds exactly the allowlisted docs, current with docs/*.md', () => {
    expect(Object.keys(sources).sort()).toEqual(allowlist.map((d) => d.slug).sort());
    for (const d of allowlist)
      expect((sources as Record<string, string>)[d.slug]).toBe(
        readFileSync(path.join(docsDir, d.file), 'utf8'),
      ); // fails when a doc changed: run `node apps/web/scripts/gen-docs.mjs`
  });

  it('never lists internal docs', () => {
    for (const d of allowlist) expect(d.file).not.toMatch(/plan|deployment|agent-login|ux|design/);
  });

  it('reads no files at request time', () => {
    for (const f of ['docs.ts', 'site.ts'])
      expect(readFileSync(path.join(__dirname, f), 'utf8')).not.toMatch(/node:fs|process\.cwd/);
  });
});
