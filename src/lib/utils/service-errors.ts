export enum ServiceErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  INSUFFICIENT_INVENTORY = 'INSUFFICIENT_INVENTORY',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  DISPUTE_INVALID_STATE = 'DISPUTE_INVALID_STATE',
  VENDOR_SUSPENDED = 'VENDOR_SUSPENDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ServiceErrorDetails {
  code: ServiceErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

export class ServiceError extends Error {
  public readonly code: ServiceErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly cause?: Error;
  public readonly timestamp: Date;

  constructor(errorDetails: ServiceErrorDetails) {
    super(errorDetails.message);
    this.name = 'ServiceError';
    this.code = errorDetails.code;
    this.details = errorDetails.details;
    this.cause = errorDetails.cause;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }

  static notFound(resource: string, identifier?: string): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.NOT_FOUND,
      message: identifier
        ? `${resource} with identifier '${identifier}' not found`
        : `${resource} not found`,
      details: { resource, identifier },
    });
  }

  static validationError(message: string, details?: Record<string, unknown>): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.VALIDATION_ERROR,
      message,
      details,
    });
  }

  static authorizationError(message: string = 'Not authorized to perform this action'): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.AUTHORIZATION_ERROR,
      message,
    });
  }

  static conflict(message: string, details?: Record<string, unknown>): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.CONFLICT,
      message,
      details,
    });
  }

  static rateLimited(retryAfter?: number): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.RATE_LIMITED,
      message: 'Too many requests, please try again later',
      details: retryAfter ? { retryAfter } : undefined,
    });
  }

  static externalServiceError(serviceName: string, cause?: Error): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.EXTERNAL_SERVICE_ERROR,
      message: `External service '${serviceName}' is unavailable or returned an error`,
      details: { serviceName },
      cause,
    });
  }

  static insufficientInventory(productId: string, requested: number, available: number): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.INSUFFICIENT_INVENTORY,
      message: `Insufficient inventory for product`,
      details: { productId, requested, available },
    });
  }

  static paymentFailed(reason: string, details?: Record<string, unknown>): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.PAYMENT_FAILED,
      message: `Payment failed: ${reason}`,
      details,
    });
  }

  static disputeInvalidState(currentState: string, attemptedAction: string): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.DISPUTE_INVALID_STATE,
      message: `Cannot ${attemptedAction} when dispute is in '${currentState}' state`,
      details: { currentState, attemptedAction },
    });
  }

  static vendorSuspended(vendorId: string): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.VENDOR_SUSPENDED,
      message: 'Vendor account is suspended',
      details: { vendorId },
    });
  }

  static internal(message: string = 'An internal error occurred', cause?: Error): ServiceError {
    return new ServiceError({
      code: ServiceErrorCode.INTERNAL_ERROR,
      message,
      cause,
    });
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function getHttpStatusFromServiceError(error: ServiceError): number {
  const statusMap: Record<ServiceErrorCode, number> = {
    [ServiceErrorCode.NOT_FOUND]: 404,
    [ServiceErrorCode.VALIDATION_ERROR]: 400,
    [ServiceErrorCode.AUTHORIZATION_ERROR]: 403,
    [ServiceErrorCode.CONFLICT]: 409,
    [ServiceErrorCode.RATE_LIMITED]: 429,
    [ServiceErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
    [ServiceErrorCode.INSUFFICIENT_INVENTORY]: 400,
    [ServiceErrorCode.PAYMENT_FAILED]: 402,
    [ServiceErrorCode.DISPUTE_INVALID_STATE]: 400,
    [ServiceErrorCode.VENDOR_SUSPENDED]: 403,
    [ServiceErrorCode.INTERNAL_ERROR]: 500,
  };

  return statusMap[error.code] || 500;
}

export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context?: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isServiceError(error)) {
      throw error;
    }

    console.error(`Error in ${context || 'operation'}:`, error);
    
    throw ServiceError.internal(
      context ? `Error in ${context}` : undefined,
      error instanceof Error ? error : undefined
    );
  }
}
