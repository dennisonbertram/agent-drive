import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  crumbs,
  fileKind,
  folderFromParam,
  listPrefix,
  recentFiles,
  sortRows,
  type TreeFile,
} from './file-tree';

const f = (path: string, extra: Partial<TreeFile> = {}): TreeFile => ({
  id: path,
  path,
  ...extra,
});

const research = [
  '/README.md',
  '/memory/project-notes.md',
  '/memory/preferences.json',
  '/inbox/request-0412-pricing-scan.md',
  '/inbox/request-0415-competitor-feed.md',
  '/inbox/request-0419-glossary.md',
  '/outputs/reports/weekly-2026-44.md',
  '/outputs/reports/weekly-2026-45.md',
  '/outputs/vendors.csv',
  '/outputs/charts/pricing-trend.svg',
  ...[1, 2, 3, 4, 5, 6].map((n) => `/logs/agent-trace-${n}.log`),
  '/work/scratch/old-outline.md',
  '/work/csv-export/q3-input.csv',
  '/config/schedule.yaml',
  '/archive/2026-10-report.md',
].map((p) => f(p));

describe('childrenOf', () => {
  it('builds root folders and files', () => {
    const rows = childrenOf(research, '/');
    expect(
      rows
        .filter((r) => r.kind === 'folder')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['archive', 'config', 'inbox', 'logs', 'memory', 'outputs', 'work']);
    expect(rows.filter((r) => r.kind === 'file').map((r) => r.name)).toEqual(['README.md']);
    const logs = rows.find((r) => r.kind === 'folder' && r.name === 'logs');
    expect(logs).toMatchObject({ items: 6, key: 'folder:/logs', path: '/logs' });
  });

  it('counts direct children and shows nested folders', () => {
    const rows = childrenOf(research, '/outputs');
    expect(rows.map((r) => r.name).sort()).toEqual(['charts', 'reports', 'vendors.csv']);
    expect(rows.find((r) => r.name === 'reports')).toMatchObject({ items: 2 });
  });

  it('shows a file and a folder with the same name as two rows', () => {
    const rows = childrenOf([f('/reports'), f('/reports/a.md')], '/');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).sort()).toEqual(['file:/reports', 'folder:/reports']);
  });

  it('keeps spaces and Unicode in names', () => {
    const rows = childrenOf([f('/inbox/Meeting notes – Q4 ünïcode.md')], '/inbox');
    expect(rows[0]).toMatchObject({ kind: 'file', name: 'Meeting notes – Q4 ünïcode.md' });
  });

  it('uses the newest created_at below a folder as its modified time', () => {
    const rows = childrenOf(
      [
        f('/a/x', { created_at: '2026-11-01T00:00:00Z' }),
        f('/a/b/y', { created_at: '2026-11-03T00:00:00Z' }),
      ],
      '/',
    );
    expect(rows[0]).toMatchObject({ modified: '2026-11-03T00:00:00Z' });
  });
});

describe('folderFromParam', () => {
  it.each([
    [null, '/'],
    ['', '/'],
    ['inbox', '/'],
    ['//a', '/'],
    ['/a//b', '/'],
    ['/a/../b', '/'],
    ['/a/./b', '/'],
    ['/a\\b', '/'],
    ['/a\0b', '/'],
    ['/a/', '/a'],
    ['/', '/'],
    ['/a/b', '/a/b'],
    ['/' + 'x'.repeat(1024), '/'],
  ])('%j -> %j', (raw, expected) => expect(folderFromParam(raw)).toBe(expected));
});

describe('sortRows', () => {
  const rows = childrenOf(
    [
      f('/b.md', { ciphertext_size: 5, created_at: '2026-11-02T00:00:00Z' }),
      f('/a10.md', { ciphertext_size: 50, created_at: '2026-11-01T00:00:00Z' }),
      f('/a2.md', { ciphertext_size: 20, created_at: '2026-11-03T00:00:00Z' }),
      f('/z/x', { created_at: '2026-10-01T00:00:00Z' }),
      f('/c/x', { created_at: '2026-10-05T00:00:00Z' }),
    ],
    '/',
  );
  for (const key of ['name', 'modified', 'size'] as const)
    for (const dir of ['asc', 'desc'] as const)
      it(`keeps folders first by ${key} ${dir}`, () => {
        const kinds = sortRows(rows, key, dir).map((r) => r.kind);
        expect(kinds).toEqual(['folder', 'folder', 'file', 'file', 'file']);
      });
  it('sorts names naturally', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual([
      'c',
      'z',
      'a2.md',
      'a10.md',
      'b.md',
    ]);
  });
  it('sorts files by size', () => {
    expect(
      sortRows(rows, 'size', 'desc')
        .map((r) => r.name)
        .slice(2),
    ).toEqual(['a10.md', 'a2.md', 'b.md']);
  });
  it('sorts folders by newest file under modified', () => {
    expect(
      sortRows(rows, 'modified', 'desc')
        .map((r) => r.name)
        .slice(0, 2),
    ).toEqual(['c', 'z']);
  });
});

describe('recentFiles', () => {
  it('excludes .agent-drive and caps at 50, newest first', () => {
    const files = [
      f('/.agent-drive/check.txt', { created_at: '2026-12-01T00:00:00Z' }),
      f('/x/.agent-drive/check.txt', { created_at: '2026-12-01T00:00:00Z' }),
      ...Array.from({ length: 60 }, (_, i) =>
        f(`/d/${i}.md`, { created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }),
      ),
    ];
    const rows = recentFiles(files);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.file.path).toBe('/d/59.md');
    expect(rows.some((r) => r.file.path.includes('.agent-drive'))).toBe(false);
  });
});

describe('crumbs, listPrefix, fileKind', () => {
  it('crumbs', () => {
    expect(crumbs('/')).toEqual([]);
    expect(crumbs('/a/b')).toEqual([
      { name: 'a', path: '/a' },
      { name: 'b', path: '/a/b' },
    ]);
  });
  it('listPrefix', () => {
    expect(listPrefix('/')).toBeNull();
    expect(listPrefix('/a')).toBe('/a');
  });
  it('fileKind', () => {
    expect(fileKind('A.MD')).toBe('text');
    expect(fileKind('x.PNG')).toBe('image');
    expect(fileKind('x.tgz')).toBe('archive');
    expect(fileKind('x.pdf')).toBe('file');
    expect(fileKind('Makefile')).toBe('file');
  });
  it('does not read object prototype names as extensions', () => {
    for (const name of ['x.constructor', 'x.__proto__', 'x.toString', 'x.hasOwnProperty'])
      expect(fileKind(name)).toBe('file');
  });
});

describe('edge cases', () => {
  it('does not match a sibling folder that shares a prefix', () => {
    const rows = childrenOf([f('/a/x.md'), f('/ab/y.md')], '/a');
    expect(rows.map((r) => r.name)).toEqual(['x.md']);
  });
  it('keeps NFC and NFD names as separate rows', () => {
    const nfc = '/caf\u00e9.md';
    const nfd = '/cafe\u0301.md';
    expect(childrenOf([f(nfc), f(nfd)], '/')).toHaveLength(2);
  });
  it('orders names that differ only by case deterministically', () => {
    const rows = childrenOf([f('/b.md'), f('/B.md'), f('/a.md')], '/');
    const once = sortRows(rows, 'name', 'asc').map((r) => r.key);
    expect(sortRows([...rows].reverse(), 'name', 'asc').map((r) => r.key)).toEqual(once);
  });
  it('handles a 50-level-deep path', () => {
    const deep = '/' + Array.from({ length: 50 }, (_, i) => 'd' + i).join('/');
    expect(childrenOf([f(deep + '/f.md')], '/')[0]).toMatchObject({ name: 'd0', items: 1 });
    expect(crumbs(deep)).toHaveLength(50);
    expect(folderFromParam(deep)).toBe(deep);
  });
});
