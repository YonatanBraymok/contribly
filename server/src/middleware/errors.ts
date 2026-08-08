import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

/** An error with an intentional HTTP status, safe to surface to the caller. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not Found',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error handlers by arity — `next` must stay in the signature.
  _next: NextFunction,
): void {
  const isHttpError = err instanceof HttpError;
  const status = isHttpError ? err.status : 500;

  // Unexpected failures get logged in full; deliberate 4xx responses do not.
  if (!isHttpError) {
    console.error('Unhandled error:', err);
  }

  res.status(status).json({
    error: isHttpError ? err.message : 'Internal Server Error',
    ...(isHttpError && err.details ? { details: err.details } : {}),
    ...(!env.isProduction && !isHttpError && err instanceof Error
      ? { message: err.message, stack: err.stack }
      : {}),
  });
}
