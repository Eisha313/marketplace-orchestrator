import { NextResponse } from 'next/server';
import { ServiceError, isServiceError, getHttpStatusFromServiceError } from './service-errors';
import { formatValidationErrors } from './validation';
import { z } from 'zod';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function successResponse<T>(
  data: T,
  status: number = 200,
  meta?: ApiSuccessResponse<T>['meta']
): NextResponse<ApiSuccessResponse<T>> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
  };

  if (meta) {
    response.meta = meta;
  }

  return NextResponse.json(response, { status });
}

export function createdResponse<T>(data: T): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, 201);
}

export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function paginatedResponse<T>(
  data: T[],
  pagination: { page: number; limit: number; total: number }
): NextResponse<ApiSuccessResponse<T[]>> {
  return successResponse(data, 200, {
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages: Math.ceil(pagination.total / pagination.limit),
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number = 500,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    response.error.details = details;
  }

  return NextResponse.json(response, { status });
}

export function validationErrorResponse(
  errors: z.ZodIssue[] | string[]
): NextResponse<ApiErrorResponse> {
  const formattedErrors = Array.isArray(errors) && errors.length > 0 && typeof errors[0] === 'object'
    ? formatValidationErrors(errors as z.ZodIssue[])
    : errors as string[];

  return errorResponse(
    'VALIDATION_ERROR',
    'Request validation failed',
    400,
    { errors: formattedErrors }
  );
}

export function unauthorizedResponse(
  message: string = 'Authentication required'
): NextResponse<ApiErrorResponse> {
  return errorResponse('UNAUTHORIZED', message, 401);
}

export function forbiddenResponse(
  message: string = 'Access denied'
): NextResponse<ApiErrorResponse> {
  return errorResponse('FORBIDDEN', message, 403);
}

export function notFoundResponse(
  resource: string = 'Resource'
): NextResponse<ApiErrorResponse> {
  return errorResponse('NOT_FOUND', `${resource} not found`, 404);
}

export function conflictResponse(
  message: string
): NextResponse<ApiErrorResponse> {
  return errorResponse('CONFLICT', message, 409);
}

export function rateLimitResponse(
  retryAfter?: number
): NextResponse<ApiErrorResponse> {
  const response = errorResponse(
    'RATE_LIMITED',
    'Too many requests, please try again later',
    429
  );

  if (retryAfter) {
    response.headers.set('Retry-After', retryAfter.toString());
  }

  return response;
}

export function internalErrorResponse(
  message: string = 'An internal error occurred'
): NextResponse<ApiErrorResponse> {
  return errorResponse('INTERNAL_ERROR', message, 500);
}

export function handleServiceError(error: unknown): NextResponse<ApiErrorResponse> {
  if (isServiceError(error)) {
    const status = getHttpStatusFromServiceError(error);
    return errorResponse(
      error.code,
      error.message,
      status,
      error.details
    );
  }

  // Log unexpected errors
  console.error('Unexpected error:', error);

  return internalErrorResponse();
}

export async function withApiErrorHandling<T>(
  handler: () => Promise<NextResponse<ApiResponse<T>>>
): Promise<NextResponse<ApiResponse<T> | ApiErrorResponse>> {
  try {
    return await handler();
  } catch (error) {
    return handleServiceError(error);
  }
}
