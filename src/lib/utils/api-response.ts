import { NextResponse } from 'next/server';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | { error: ApiError };

export class ApiResponseBuilder {
  static success<T>(data: T, meta?: ApiSuccess<T>['meta'], status = 200): NextResponse {
    const response: ApiSuccess<T> = { data };
    if (meta) {
      response.meta = meta;
    }
    return NextResponse.json(response, { status });
  }

  static created<T>(data: T): NextResponse {
    return this.success(data, undefined, 201);
  }

  static noContent(): NextResponse {
    return new NextResponse(null, { status: 204 });
  }

  static error(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ): NextResponse {
    const error: ApiError = { code, message };
    if (details) {
      error.details = details;
    }
    return NextResponse.json({ error }, { status });
  }

  static badRequest(message: string, details?: Record<string, unknown>): NextResponse {
    return this.error('BAD_REQUEST', message, 400, details);
  }

  static unauthorized(message = 'Authentication required'): NextResponse {
    return this.error('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'Access denied'): NextResponse {
    return this.error('FORBIDDEN', message, 403);
  }

  static notFound(resource = 'Resource'): NextResponse {
    return this.error('NOT_FOUND', `${resource} not found`, 404);
  }

  static conflict(message: string): NextResponse {
    return this.error('CONFLICT', message, 409);
  }

  static tooManyRequests(retryAfter?: number): NextResponse {
    const response = this.error('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
    if (retryAfter) {
      response.headers.set('Retry-After', retryAfter.toString());
    }
    return response;
  }

  static internalError(message = 'Internal server error'): NextResponse {
    return this.error('INTERNAL_ERROR', message, 500);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable'): NextResponse {
    return this.error('SERVICE_UNAVAILABLE', message, 503);
  }
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return ApiResponseBuilder.notFound();
    }
    if (error.message.includes('unauthorized') || error.message.includes('authentication')) {
      return ApiResponseBuilder.unauthorized();
    }
    if (error.message.includes('forbidden') || error.message.includes('permission')) {
      return ApiResponseBuilder.forbidden();
    }
    if (error.message.includes('validation')) {
      return ApiResponseBuilder.badRequest(error.message);
    }
  }

  return ApiResponseBuilder.internalError();
}

export function validateRequiredFields<T extends Record<string, unknown>>(
  data: T,
  requiredFields: (keyof T)[]
): { valid: boolean; missing: string[] } {
  const missing = requiredFields.filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === ''
  );
  return {
    valid: missing.length === 0,
    missing: missing.map(String),
  };
}

export function parseQueryParams(searchParams: URLSearchParams): {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, string>;
} {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const sortBy = searchParams.get('sortBy') || undefined;
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

  const filters: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (!['page', 'limit', 'sortBy', 'sortOrder'].includes(key)) {
      filters[key] = value;
    }
  });

  return { page, limit, sortBy, sortOrder, filters };
}
