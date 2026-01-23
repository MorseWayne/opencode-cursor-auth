/**
 * Unified Error Handling Module
 * 
 * Provides standardized error types for consistent error handling
 * across the application.
 */

/**
 * Base error class for application-specific errors
 */
export class AppError extends Error {
  /** Error code for categorization */
  public readonly code: string;
  /** HTTP status code */
  public readonly status: number;
  /** Original error that caused this error */
  public readonly cause?: Error;
  /** Additional context for debugging */
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status = 500,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.cause = options?.cause;
    this.context = options?.context;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to JSON for logging or API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Error codes for different error categories
 */
export const ErrorCodes = {
  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  CONNECTION_REFUSED: "CONNECTION_REFUSED",
  
  // Authentication errors
  AUTH_FAILED: "AUTH_FAILED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  
  // Validation errors
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  MISSING_PARAMETER: "MISSING_PARAMETER",
  
  // Security errors
  SECURITY_ERROR: "SECURITY_ERROR",
  PATH_TRAVERSAL: "PATH_TRAVERSAL",
  COMMAND_INJECTION: "COMMAND_INJECTION",
  
  // Resource errors
  NOT_FOUND: "NOT_FOUND",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  BUFFER_OVERFLOW: "BUFFER_OVERFLOW",
  
  // Service errors
  SERVICE_ERROR: "SERVICE_ERROR",
  AGENT_ERROR: "AGENT_ERROR",
  PARSE_ERROR: "PARSE_ERROR",
  
  // Unknown errors
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Network-related error
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, ErrorCodes.NETWORK_ERROR, 502, options);
    this.name = "NetworkError";
  }

  /**
   * Check if an error is a network error
   */
  static isNetworkError(error: unknown): boolean {
    if (error instanceof NetworkError) return true;
    if (!(error instanceof Error)) return false;
    
    const msg = error.message.toLowerCase();
    return (
      msg.includes("socket") ||
      msg.includes("connection") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("epipe") ||
      msg.includes("fetch") ||
      msg.includes("network")
    );
  }
}

/**
 * Authentication-related error
 */
export class AuthError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.AUTH_FAILED,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, 401, options);
    this.name = "AuthError";
  }
}

/**
 * Validation-related error
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, ErrorCodes.VALIDATION_ERROR, 400, options);
    this.name = "ValidationError";
  }
}

/**
 * Security-related error
 */
export class SecurityError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.SECURITY_ERROR,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, 403, options);
    this.name = "SecurityError";
  }
}

/**
 * Agent service error
 */
export class AgentServiceError extends AppError {
  /** Request ID for correlation */
  public readonly requestId?: string;

  constructor(
    message: string,
    options?: { requestId?: string; cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, ErrorCodes.AGENT_ERROR, 500, {
      cause: options?.cause,
      context: { ...options?.context, requestId: options?.requestId },
    });
    this.name = "AgentServiceError";
    this.requestId = options?.requestId;
  }
}

/**
 * Parse/decode error
 */
export class ParseError extends AppError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, ErrorCodes.PARSE_ERROR, 500, options);
    this.name = "ParseError";
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends AppError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, ErrorCodes.TIMEOUT, 504, options);
    this.name = "TimeoutError";
  }
}

/**
 * Wrap an unknown error into an AppError
 */
export function wrapError(
  error: unknown,
  defaultMessage = "An unexpected error occurred"
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (NetworkError.isNetworkError(error)) {
      return new NetworkError(error.message, { cause: error });
    }
    
    return new AppError(error.message, ErrorCodes.UNKNOWN, 500, { cause: error });
  }

  return new AppError(
    typeof error === "string" ? error : defaultMessage,
    ErrorCodes.UNKNOWN,
    500
  );
}

/**
 * Extract a safe error message for external responses
 * (avoids leaking internal details)
 */
export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    // For security errors, don't expose details
    if (error instanceof SecurityError) {
      return "Access denied";
    }
    return error.message;
  }

  if (error instanceof Error) {
    // For network errors, give a generic message
    if (NetworkError.isNetworkError(error)) {
      return "Network error occurred";
    }
    return error.message;
  }

  return "An unexpected error occurred";
}

/**
 * Check if an error is retryable (for retry logic)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof NetworkError) return true;
  
  if (error instanceof AppError) {
    return error.code === ErrorCodes.NETWORK_ERROR || error.code === ErrorCodes.TIMEOUT;
  }

  return NetworkError.isNetworkError(error);
}
