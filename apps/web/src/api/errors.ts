export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'payment_required'
  | 'rate_limited'
  | 'share_revoked'
  | 'share_expired'
  | 'share_unavailable'
  | 'internal_error';

const statuses: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  quota_exceeded: 413,
  payment_required: 402,
  rate_limited: 429,
  share_revoked: 410,
  share_expired: 410,
  share_unavailable: 410,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    status = statuses[code],
    readonly details: {
      upgradeUrl?: string;
      limit?: 'drives' | 'storage' | 'operations' | 'downloads';
      retryAfter?: number;
      currentVersionId?: string | null;
      state?: 'exists' | 'changed' | 'trashed' | 'absent';
    } = {},
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
    { error: { code: apiError.code, message: apiError.message, ...apiError.details } },
    {
      status: apiError.status,
      headers: {
        'Cache-Control': 'no-store',
        ...(apiError.details.retryAfter === undefined
          ? {}
          : { 'Retry-After': String(apiError.details.retryAfter) }),
      },
    },
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
