import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export function ok(res: Response, data: unknown, meta?: unknown) {
  return res.json({ data, ...(meta ? { meta } : {}) });
}
export function requestId(req: Request, res: Response, next: NextFunction) {
  res.locals.requestId = randomUUID();
  res.setHeader("X-Request-ID", res.locals.requestId);
  next();
}
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) return _next(err);
  let status =
    err instanceof ZodError ||
    err.name === "ValidationError" ||
    err.name === "CastError"
      ? 400
      : err.status || 500;
  if (err.code === 11000) status = 409;
  if (err.name === "MulterError")
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  const message =
    status >= 500
      ? "The service is temporarily unavailable. Please try again."
      : err.code === 11000
        ? "This record already exists."
        : err instanceof ZodError
          ? err.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : err.message;
  res.status(status).json({
    error: {
      code: status >= 500 ? "SERVICE_ERROR" : err.code || "INVALID_REQUEST",
      message,
      requestId: res.locals.requestId,
    },
  });
}
export function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value))
    throw new HttpError(400, "Invalid record identifier");
  return value;
}
