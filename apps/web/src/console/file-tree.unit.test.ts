import { describe, expect, it } from 'vitest';
import {
  crumbs,
  fileKind,
  folderFromParam,
  listPrefix,
  recentFiles,
  rowsFromListing,
  sortRows,
  type ListItem,
  type TreeFile,
} from './file-tree';

const f = (path: string, extra: Partial<TreeFile> = {}): TreeFile => ({
  id: path,
  path,
  ...extra,
});

// Rows as the server's folder listing returns them (delimiter=/).
const dir = (path: string, items: number, created_at = '2026-11-01T00:00:00Z'): ListItem => ({
  kind: 'folder',
  path,
  items,
  ciphertext_size: 100,
  created_at,
});
const file = (path: string, extra: Partial<TreeFile> = {}): ListItem => ({
  kind: 'file',
  ...f(path, extra),
});

describe('rowsFromListing', () => {
  it('maps a folder item to a folder row with the server count, size and time', () => {
    const rows = rowsFromListing([dir('/logs', 1000, '2026-11-03T00:00:00Z')], '/');
    expect(rows).toEqual([
      {
        kind: 'folder',
        key: 'folder:/logs',
        name: 'logs',
        path: '/logs',
        items: 1000,
        size: 100,
        modified: '2026-11-03T00:00:00Z',
      },
    ]);
  });

  it('maps a file item to a file row under its folder', () => {
    const item = file('/inbox/Meeting notes – Q4 ünïcode.md');
    const rows = rowsFromListing([item], '/inbox');
    expect(rows[0]).toMatchObject({
      kind: 'file',
      key: 'file:/inbox/Meeting notes – Q4 ünïcode.md',
      name: 'Meeting notes – Q4 ünïcode.md',
      parent: '/inbox',
    });
  });

  it('shows a file and a folder with the same name as two rows', () => {
    const rows = rowsFromListing([file('/reports'), dir('/reports', 2)], '/');
    expect(rows.map((r) => r.key).sort()).toEqual(['file:/reports', 'folder:/reports']);
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
  const rows = rowsFromListing(
    [
      file('/b.md', { ciphertext_size: 5, created_at: '2026-11-02T00:00:00Z' }),
      file('/a10.md', { ciphertext_size: 50, created_at: '2026-11-01T00:00:00Z' }),
      file('/a2.md', { ciphertext_size: 20, created_at: '2026-11-03T00:00:00Z' }),
      dir('/z', 1, '2026-10-01T00:00:00Z'),
      dir('/c', 1, '2026-10-05T00:00:00Z'),
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
  it('keeps NFC and NFD names as separate rows', () => {
    const nfc = '/caf\u00e9.md';
    const nfd = '/cafe\u0301.md';
    expect(rowsFromListing([file(nfc), file(nfd)], '/')).toHaveLength(2);
  });
  it('orders names that differ only by case deterministically', () => {
    const rows = rowsFromListing([file('/b.md'), file('/B.md'), file('/a.md')], '/');
    const once = sortRows(rows, 'name', 'asc').map((r) => r.key);
    expect(sortRows([...rows].reverse(), 'name', 'asc').map((r) => r.key)).toEqual(once);
  });
  it('handles a 50-level-deep path', () => {
    const deep = '/' + Array.from({ length: 50 }, (_, i) => 'd' + i).join('/');
    expect(crumbs(deep)).toHaveLength(50);
    expect(folderFromParam(deep)).toBe(deep);
  });
});
