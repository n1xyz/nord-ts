/**
 * Options for creating a NordError
 */
export interface NordErrorOptions {
  /** The original error that caused this error */
  cause?: unknown;

  /** HTTP status code (if applicable) */
  statusCode?: number;

  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Custom error class for Nord-related errors
 */
export class NordError extends Error {
  /** The original error that caused this error */
  public readonly cause?: unknown;

  /** HTTP status code (if applicable) */
  public readonly statusCode?: number;

  /** Additional error details */
  public readonly details?: Record<string, unknown>;

  /**
   * Create a new NordError
   *
   * @param message - Error message
   * @param options - Error options
   */
  constructor(message: string, options: NordErrorOptions = {}) {
    super(message);

    this.name = "NordError";
    this.cause = options.cause;
    this.statusCode = options.statusCode;
    this.details = options.details;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NordError);
    }

    // Handle nested errors
    if (this.cause instanceof Error) {
      this.stack =
        this.stack + "\nCaused by: " + (this.cause.stack || this.cause.message);
    }
  }

  /**
   * Convert the error to a string representation
   *
   * @returns String representation of the error
   */
  toString(): string {
    let result = `${this.name}: ${this.message}`;

    if (this.statusCode) {
      result += `  \nstatus: ${this.statusCode}`;
    }

    if (this.details && Object.keys(this.details).length > 0) {
      result += `  \ndetails: ${JSON.stringify(this.details, null, 2)}`;
    }

    if (this.cause) {
      result += `  \ncause: ${this.cause.toString()}`;
    }

    return result;
  }
}
