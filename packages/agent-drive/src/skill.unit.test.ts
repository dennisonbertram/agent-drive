import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { installSkill, packagedSkillPath } from './skill.js';

const dirs: string[] = [];
afterEach(() => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));
const home = async () => {
  const d = await mkdtemp(join(tmpdir(), 'agent-drive-skill-'));
  dirs.push(d);
  return d;
};

it('writes to the claude and codex dirs that exist', async () => {
  const h = await home();
  await mkdir(join(h, '.claude'));
  const written = await installSkill(undefined, h);
  expect(written).toEqual([join(h, '.claude/skills/agent-drive/SKILL.md')]);
  expect(await readFile(written[0]!, 'utf8')).toContain('name: agent-drive');
  await mkdir(join(h, '.codex'));
  expect(await installSkill(undefined, h)).toHaveLength(2);
});

it('supports explicit targets and finds nothing without dirs', async () => {
  const h = await home();
  expect(await installSkill(undefined, h)).toEqual([]);
  expect(await installSkill('codex', h)).toEqual([join(h, '.codex/skills/agent-drive/SKILL.md')]);
  const custom = join(h, 'custom');
  expect(await installSkill(custom, h)).toEqual([join(custom, 'SKILL.md')]);
  expect(packagedSkillPath()).toMatch(/SKILL\.md$/);
});

it('refuses to overwrite a symlink destination', async () => {
  const h = await home();
  const dir = join(h, 'custom');
  await mkdir(dir);
  const victim = join(h, 'victim');
  await writeFile(victim, 'keep');
  await symlink(victim, join(dir, 'SKILL.md'));
  await expect(installSkill(dir, h)).rejects.toThrow(/symlink/);
  expect(await readFile(victim, 'utf8')).toBe('keep');
});
