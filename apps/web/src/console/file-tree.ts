// Pure folder-view logic for the console file browser. The API returns flat paths;
// folders exist only as path prefixes, so they are derived here from the loaded rows.
export type TreeFile = {
  id: string;
  path: string;
  ciphertext_size?: number;
  created_at?: string;
  agent_id?: string;
  version_id?: string;
};
export type FolderRow = {
  kind: 'folder';
  key: string;
  name: string;
  path: string;
  items: number;
  modified?: string | undefined;
};
export type FileRow = { kind: 'file'; key: string; name: string; parent: string; file: TreeFile };
export type Row = FolderRow | FileRow;
export type SortKey = 'name' | 'modified' | 'size';
export const ROOT = '/';

export function folderFromParam(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.length > 1024) return ROOT;
  if (raw.includes('//') || raw.includes('\\') || raw.includes('\0')) return ROOT;
  const path = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return ROOT;
  return path;
}

const newer = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : (a ?? b));

export function childrenOf(files: TreeFile[], folder: string): Row[] {
  const base = folder === ROOT ? '/' : folder + '/';
  const folders = new Map<string, { row: FolderRow; direct: Set<string> }>();
  const rows: Row[] = [];
  for (const file of files) {
    if (!file.path.startsWith(base)) continue;
    const rest = file.path.slice(base.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      rows.push({ kind: 'file', key: 'file:' + file.id, name: rest, parent: folder, file });
      continue;
    }
    const name = rest.slice(0, slash);
    let entry = folders.get(name);
    if (!entry) {
      entry = {
        row: { kind: 'folder', key: 'folder:' + base + name, name, path: base + name, items: 0 },
        direct: new Set(),
      };
      folders.set(name, entry);
    }
    // Direct children of the folder: a file name, or a subfolder name with a trailing '/'.
    const inner = rest.slice(slash + 1);
    const next = inner.indexOf('/');
    entry.direct.add(next === -1 ? inner : inner.slice(0, next + 1));
    entry.row.modified = newer(entry.row.modified, file.created_at);
  }
  for (const { row, direct } of folders.values()) rows.push({ ...row, items: direct.size });
  return rows;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortRows(rows: Row[], key: SortKey, dir: 'asc' | 'desc'): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: Row, b: Row) => collator.compare(a.name, b.name) || (a.key < b.key ? -1 : 1);
  const value = (row: Row) => (row.kind === 'folder' ? row.modified : row.file.created_at);
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (key === 'size' && a.kind === 'folder') return byName(a, b); // folders keep name order
    let order = 0;
    if (key === 'modified') order = (value(a) ?? '').localeCompare(value(b) ?? '');
    if (key === 'size' && a.kind === 'file' && b.kind === 'file')
      order = (a.file.ciphertext_size ?? 0) - (b.file.ciphertext_size ?? 0);
    if (key === 'name') order = collator.compare(a.name, b.name);
    return order ? order * sign : byName(a, b);
  });
}

export function crumbs(folder: string): { name: string; path: string }[] {
  const parts = folder.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }));
}

export function recentFiles(files: TreeFile[], limit = 50): FileRow[] {
  return files
    .filter((file) => !file.path.split('/').includes('.agent-drive'))
    .sort(
      (a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? '') || (a.path < b.path ? -1 : 1),
    )
    .slice(0, limit)
    .map((file) => {
      const cut = file.path.lastIndexOf('/');
      return {
        kind: 'file' as const,
        key: 'file:' + file.id,
        name: file.path.slice(cut + 1),
        parent: cut === 0 ? ROOT : file.path.slice(0, cut),
        file,
      };
    });
}

const KINDS: Record<string, 'text' | 'image' | 'archive'> = {};
for (const ext of 'md txt log csv tsv json jsonl yaml yml toml xml html css js ts tsx py sh sql'.split(
  ' ',
))
  KINDS[ext] = 'text';
for (const ext of 'png jpg jpeg gif webp svg heic'.split(' ')) KINDS[ext] = 'image';
for (const ext of 'zip tar gz tgz bz2 xz 7z'.split(' ')) KINDS[ext] = 'archive';

export function fileKind(name: string): 'text' | 'image' | 'archive' | 'file' {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'file';
  return KINDS[name.slice(dot + 1).toLowerCase()] ?? 'file';
}

export function listPrefix(folder: string): string | null {
  return folder === ROOT ? null : folder;
}
