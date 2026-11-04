import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSafely } from './safe-write.js';

/** dist/SKILL.md when built (copied by the build script); the repo copy when run from src. */
export function packagedSkillPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'SKILL.md'), join(here, '../../../skills/agent-drive/SKILL.md')];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

const isDir = async (p: string) => (await stat(p).catch(() => undefined))?.isDirectory() ?? false;

/** Copies the skill to the target dirs; returns the paths written. */
export async function installSkill(
  target: string | undefined,
  home = process.env.HOME ?? homedir(),
) {
  const dirs: string[] = [];
  const claude = join(home, '.claude/skills/agent-drive');
  const codex = join(home, '.codex/skills/agent-drive');
  if (target === 'claude') dirs.push(claude);
  else if (target === 'codex') dirs.push(codex);
  else if (target) dirs.push(target);
  else {
    if (await isDir(join(home, '.claude'))) dirs.push(claude);
    if (await isDir(join(home, '.codex'))) dirs.push(codex);
  }
  const written: string[] = [];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    await writeFileSafely(join(dir, 'SKILL.md'), await readFile(packagedSkillPath(), 'utf8'), {
      mode: 0o644,
      overwrite: true,
    });
    written.push(join(dir, 'SKILL.md'));
  }
  return written;
}
