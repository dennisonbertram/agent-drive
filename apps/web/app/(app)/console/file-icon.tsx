export type FileIconKind = 'folder' | 'text' | 'image' | 'archive' | 'file';

// 16 px outline glyphs that take the surrounding text colour.
const PATHS: Record<FileIconKind, string> = {
  folder:
    'M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z',
  file: 'M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM9 2v3h3',
  text: 'M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM9 2v3h3M6 8h4M6 10.5h4',
  image:
    'M2.5 3h11a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zM2.5 11l3.5-3.5 3 3 1.5-1.5 3 3M10.5 6.2h.01',
  archive:
    'M4 2h8a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM8 2v7M8 4h1.5M6.5 6h1.5M8 8h1.5M6.5 9h3v2.5h-3z',
};

export function FileIcon({ kind }: { kind: FileIconKind }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}
