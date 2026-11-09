import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './docs.allowlist.json';
import sources from './docs.generated.json';
import { SECTIONS, docBody, docNeighbors, sectionedDocs } from './docs';

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
    const priv = ['plan.md', 'deployment.md', 'simulation.md', 'user-stories.md', 'agent-login.md'];
    for (const d of allowlist) {
      expect(priv).not.toContain(d.file);
      expect(d.file).not.toMatch(/ux|design/);
    }
  });

  it('has unique slugs, existing files and an allowed section on every entry', () => {
    const slugs = allowlist.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const d of allowlist) {
      expect(existsSync(path.join(docsDir, d.file)), d.file).toBe(true);
      expect(['Get started', 'Guides', 'Reference', 'Security']).toContain(d.section);
    }
  });

  it('keeps links to another doc with an anchor', () => {
    expect(docBody('sandboxes', (s) => `/docs/${s}`)).toContain(
      '[Codex approval](/docs/mcp-tools#codex-approval)',
    );
  });

  it('reads no files at request time', () => {
    for (const f of ['docs.ts', 'site.ts'])
      expect(readFileSync(path.join(__dirname, f), 'utf8')).not.toMatch(/node:fs|process\.cwd/);
  });

  it('groups docs by section in allowlist order', () => {
    expect(SECTIONS).toEqual(['Get started', 'Guides', 'Reference', 'Security']);
    const groups = sectionedDocs();
    expect(groups.map((g) => g.section)).toEqual([...SECTIONS]);
    expect(groups.flatMap((g) => g.docs.map((d) => d.slug))).toEqual(allowlist.map((d) => d.slug));
  });

  it('returns previous and next across sections, null at the ends', () => {
    const slugs = allowlist.map((d) => d.slug);
    expect(docNeighbors(slugs[0]!)).toEqual({ prev: null, next: allowlist[1] });
    expect(docNeighbors(slugs.at(-1)!)).toEqual({ prev: allowlist.at(-2), next: null });
    expect(docNeighbors('nope')).toEqual({ prev: null, next: null });
    const i = slugs.indexOf('cli');
    expect(docNeighbors('cli').prev?.slug).toBe(slugs[i - 1]);
    expect(docNeighbors('cli').next?.slug).toBe(slugs[i + 1]);
  });
});
