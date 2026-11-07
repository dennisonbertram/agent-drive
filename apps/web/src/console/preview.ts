// Preview rules. Files are agent-written and untrusted, so the console decides what each
// extension may become. HTML and SVG are text on purpose: they are shown as source, never rendered.
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export type PreviewKind = 'text' | 'image' | 'pdf' | 'none';
type PreviewMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf';

const TEXT = new Set(
  'md markdown txt log csv tsv json jsonl ndjson yaml yml toml ini env xml html htm svg css js mjs cjs ts tsx jsx py rb go rs java sh bash zsh sql diff patch'.split(
    ' ',
  ),
);
// Fixed allowlist. The MIME type comes only from here, never from file content or metadata.
const MIME: Record<string, PreviewMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function extension(name: string) {
  const last = name.split('/').at(-1) ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 || (dot === 0 && last.length > 1) ? last.slice(dot + 1).toLowerCase() : '';
}

export function previewMime(name: string): PreviewMime | null {
  const ext = extension(name);
  return Object.hasOwn(MIME, ext) ? (MIME[ext] ?? null) : null;
}

export function previewKind(name: string): PreviewKind {
  const ext = extension(name);
  if (TEXT.has(ext)) return 'text';
  const mime = previewMime(name);
  if (!mime) return 'none';
  return mime === 'application/pdf' ? 'pdf' : 'image';
}

export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}
