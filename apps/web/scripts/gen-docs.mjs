// Embeds the allowlisted docs/*.md files in src/content/docs.generated.json at build time, so the
// running app never reads the docs/ folder. Run by `pnpm build`; a unit test checks it is current.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, '..', 'src', 'content');
const docsDir = path.join(here, '..', '..', '..', 'docs');
const allow = JSON.parse(readFileSync(path.join(content, 'docs.allowlist.json'), 'utf8'));

export const generate = () =>
  JSON.stringify(
    Object.fromEntries(
      allow.map((d) => [d.slug, readFileSync(path.join(docsDir, d.file), 'utf8')]),
    ),
    null,
    2,
  ) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(content, 'docs.generated.json'), generate());
}
