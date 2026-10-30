export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'internal_error';

const statuses: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  quota_exceeded: 413,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    status = statuses[code],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function responseForError(error: unknown) {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError('internal_error', 'An internal error occurred.');
  return Response.json(
    { error: { code: apiError.code, message: apiError.message } },
    { status: apiError.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function errorFromDatabase(error: unknown): ApiError {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return new ApiError('conflict', 'The resource already exists.');
    if (code === '23503')
      return new ApiError('validation_error', 'The referenced resource is invalid.');
    if (code === '23514')
      return new ApiError('validation_error', 'The request violates a data constraint.');
  }
  return error instanceof ApiError
    ? error
    : new ApiError('internal_error', 'An internal error occurred.');
}
