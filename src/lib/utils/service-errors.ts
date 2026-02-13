export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INSUFFICIENT_INVENTORY'
  | 'PAYMENT_FAILED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ServiceError extends Error {
  public readonly code: ServiceErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ServiceErrorCode = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = this.getStatusCode(code);
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  private getStatusCode(code: ServiceErrorCode): number {
    const statusCodes: Record<ServiceErrorCode, number> = {
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INSUFFICIENT_INVENTORY: 422,
      PAYMENT_FAILED: 402,
      EXTERNAL_SERVICE_ERROR: 502,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
    };
    return statusCodes[code] || 500;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: {
        message: this.message,
        code: this.code,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function handleServiceError(error: unknown): ServiceError {
  if (isServiceError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Handle Prisma errors
    if (error.message.includes('Record to update not found')) {
      return new ServiceError('Resource not found', 'NOT_FOUND');
    }
    if (error.message.includes('Unique constraint failed')) {
      return new ServiceError('Resource already exists', 'CONFLICT');
    }
    if (error.message.includes('Foreign key constraint failed')) {
      return new ServiceError('Referenced resource not found', 'VALIDATION_ERROR');
    }

    return new ServiceError(
      process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
      'INTERNAL_ERROR'
    );
  }

  return new ServiceError('An unexpected error occurred', 'INTERNAL_ERROR');
}

export function assertDefined<T>(
  value: T | null | undefined,
  errorMessage: string,
  errorCode: ServiceErrorCode = 'NOT_FOUND'
): T {
  if (value === null || value === undefined) {
    throw new ServiceError(errorMessage, errorCode);
  }
  return value;
}
