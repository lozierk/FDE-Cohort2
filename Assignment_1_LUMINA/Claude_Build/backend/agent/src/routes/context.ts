import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_HEADER, USER_HEADER, type ErrorBody } from '@lumina/contract';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    requestId?: string;
  }
}

export function sendError(res: Response, status: number, error: string, extra: Partial<ErrorBody> = {}): void {
  const body: ErrorBody = { error, status, ...extra };
  if (res.req?.requestId) body.requestId = res.req.requestId;
  res.status(status).json(body);
}

/** Reuse the gateway's request id when it forwarded one, else mint one; always echo it back. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_HEADER);
  req.requestId = inbound?.trim() || `req_${randomUUID()}`;
  res.setHeader(REQUEST_HEADER, req.requestId);
  next();
}

/**
 * The gateway checks this first. The agent checks it again because a cap you can bypass by
 * reaching the agent service directly is not a cap — and on Fly the agent is private, but
 * "private" is a network setting, not an authorisation.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header(USER_HEADER)?.trim();
  if (!userId) {
    sendError(res, 401, `missing ${USER_HEADER}`);
    return;
  }
  req.userId = userId;
  next();
}
