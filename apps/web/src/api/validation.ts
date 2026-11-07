import { ApiError } from './errors';

export const MAX_BODY_BYTES = 256 * 1024;
// Percent-encoding can expand a 1024-character Unicode path to 9216 characters.
export const MAX_QUERY_LENGTH = 16 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_PAGE_SIZE = 100;

export function secureTransportAllowed(protocol: string, environment: string | undefined) {
  return environment !== 'production' || protocol === 'https:';
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('validation_error', 'The JSON body must be an object.');
  }
  return value as Record<string, unknown>;
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw new ApiError('validation_error', 'The JSON body is too large.');
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError('validation_error', 'The JSON body is too large.');
      }
      chunks.push(value);
    }
  } catch {
    if (reader && length > MAX_BODY_BYTES) {
      throw new ApiError('validation_error', 'The JSON body is too large.');
    }
    throw new ApiError('validation_error', 'The JSON body could not be read.');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return objectBody(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new ApiError('validation_error', 'The request body must be valid JSON.');
  }
}

export function stringField(
  body: Record<string, unknown>,
  name: string,
  options: { required?: boolean; max?: number } = {},
): string | undefined {
  const value = body[name];
  if (value === undefined && !options.required) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('validation_error', `${name} must be a non-empty string.`);
  }
  const max = options.max ?? 256;
  if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ApiError('validation_error', `${name} is too long or contains control characters.`);
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, name: string, max = 256) {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  return stringField(body, name, { max });
}

export function uuid(value: string | undefined, name: string): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ApiError('validation_error', `${name} must be a UUID.`);
  }
  return value;
}

export function canonicalPath(value: unknown, name = 'path'): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 1024) {
    throw new ApiError('validation_error', `${name} must be an absolute POSIX path.`);
  }
  if (
    !value.startsWith('/') ||
    value.includes('\u0000') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.endsWith('/') ||
    value
      .split('/')
      .some((part, index) => index > 0 && (part === '.' || part === '..' || part === ''))
  ) {
    throw new ApiError('validation_error', `${name} must be a canonical absolute POSIX path.`);
  }
  return value;
}

export function prefix(value: string | null): string {
  if (!value) return '';
  if (value === '/') return '/';
  if (
    !value.startsWith('/') ||
    value.length > 1024 ||
    value.includes('\u0000') ||
    value.includes('//') ||
    value.includes('\\')
  ) {
    throw new ApiError('validation_error', 'prefix must be a canonical absolute POSIX prefix.');
  }
  return value.endsWith('/') ? value : `${value}/`;
}

export function tags(body: Record<string, unknown>): string[] {
  const value = body.tags;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 64)
  ) {
    throw new ApiError('validation_error', 'tags must contain at most 32 short strings.');
  }
  return [...new Set(value as string[])];
}

export function writePaths(body: Record<string, unknown>): string[] {
  const value = body.writePaths;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16)
    throw new ApiError('validation_error', 'writePaths must contain at most 16 paths.');
  return [...new Set(value.map((item) => canonicalPath(item, 'writePaths')))];
}

/**
 * A key may hand out only what it holds. Needs `delegate`; never grants manage or delegate;
 * a path-restricted caller must name write paths inside its own. Not applied to manage callers.
 */
export function assertDelegation(
  auth: { driveIds: string[]; scopes: string[]; writePaths: string[] },
  requested: { driveIds: string[]; scopes: string[]; writePaths: string[] },
) {
  if (!auth.scopes.includes('delegate'))
    throw new ApiError('permission_denied', 'The API key needs the delegate scope.');
  const grantable = ['read', 'write', 'delete', 'share'];
  const ok =
    requested.driveIds.every((id) => auth.driveIds.includes(id)) &&
    requested.scopes.every((s) => grantable.includes(s) && auth.scopes.includes(s)) &&
    (auth.writePaths.length === 0 ||
      (requested.writePaths.length > 0 &&
        requested.writePaths.every((p) => withinWritePaths(auth.writePaths, p))));
  if (!ok) throw new ApiError('permission_denied', 'A key cannot grant more than it holds.');
}

/** An empty list means no restriction. A path matches itself and anything beneath it. */
export function withinWritePaths(paths: string[], path: string) {
  return paths.length === 0 || paths.some((p) => path === p || path.startsWith(`${p}/`));
}

export function boundedSize(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_UPLOAD_BYTES
  ) {
    throw new ApiError('validation_error', `${name} must be a positive bounded integer.`);
  }
  return value;
}

export function page(url: URL) {
  const parsed = Number(url.searchParams.get('limit') ?? 50);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new ApiError('validation_error', `limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor && cursor.length > 2048) throw new ApiError('validation_error', 'cursor is too long.');
  return { limit: parsed, cursor: cursor ?? undefined };
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export type CursorPayload = { value: string; id: string };

export function decodeCursor(
  value: string | undefined,
  kind: 'name' | 'path' | 'timestamp' | 'share' | 'seq' | 'child',
  childSort: ListSort = 'path',
): CursorPayload | undefined {
  if (!value) return undefined;
  if (value.length > 2048) throw new ApiError('validation_error', 'cursor is too long.');
  try {
    if (kind === 'child') return decodeChildCursor(value, childSort);
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical cursor');
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('invalid cursor');
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.value !== 'string' ||
      record.value.length === 0 ||
      record.value.length > (kind === 'path' ? 1024 : 128) ||
      typeof record.id !== 'string' ||
      !(kind === 'share'
        ? /^[A-Za-z0-9_-]{22}$/u.test(record.id)
        : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            record.id,
          ))
    ) {
      throw new Error('invalid cursor');
    }
    if (kind === 'path') canonicalPath(record.value, 'cursor path');
    if ((kind === 'timestamp' || kind === 'share') && Number.isNaN(Date.parse(record.value)))
      throw new Error('invalid timestamp');
    if (kind === 'seq') {
      if (!/^\d{1,19}$/u.test(record.value)) throw new Error('invalid seq');
      const seq = BigInt(record.value);
      if (seq < 1n || seq > 9223372036854775807n) throw new Error('seq out of range');
    }
    return { value: record.value, id: record.id };
  } catch {
    throw new ApiError('validation_error', 'cursor is invalid.');
  }
}

export type ListSort = 'path' | 'modified';

export function listSort(value: string | null): ListSort {
  if (value === null || value === 'path') return 'path';
  if (value === 'modified') return 'modified';
  throw new ApiError('validation_error', 'sort must be path or modified.');
}

export function listDelimiter(value: string | null): boolean {
  if (value === null) return false;
  if (value === '/') return true;
  throw new ApiError('validation_error', 'delimiter must be /.');
}

// Folder-listing cursor: id is the child key (path, folders end in "/"); value is the key for the
// path sort or the row's created_at::text for the modified sort. The two never overlap, so a
// cursor from the other sort fails.
function decodeChildCursor(value: string, sort: ListSort): CursorPayload {
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const record = parsed as Record<string, unknown>;
  if (
    Buffer.from(value, 'base64url').toString('base64url') !== value ||
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(record).length !== 2 ||
    typeof record.value !== 'string' ||
    typeof record.id !== 'string' ||
    !record.id.startsWith('/') ||
    record.id.length > 1025 ||
    record.id.includes('\u0000') ||
    record.value.length === 0 ||
    record.value.length > 1025 ||
    (sort === 'path'
      ? record.value !== record.id
      : !/^\d{4}-\d\d-\d\d[ T][\d:.]+Z$/u.test(record.value) ||
        Number.isNaN(Date.parse(record.value)))
  )
    throw new Error('invalid cursor');
  return { value: record.value, id: record.id };
}

export function escapedLike(value: string): string {
  if (value.length > 128) throw new ApiError('validation_error', 'q is too long.');
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export function escapeLikeLiteral(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function queryValue(url: URL, name: string, max = 256) {
  const value = url.searchParams.get(name);
  if (value !== null && (value.length > max || value.includes('\u0000'))) {
    throw new ApiError('validation_error', `${name} is too long or invalid.`);
  }
  return value;
}
