// src/utils/AppError.ts
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }> | undefined;

  constructor(
    message: string, 
    statusCode: number = 500, 
    errors?: Array<{ field: string; message: string; value?: unknown }>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}