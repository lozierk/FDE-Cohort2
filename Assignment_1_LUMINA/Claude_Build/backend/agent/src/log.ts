import pino from 'pino';
import { env } from './env.js';

/**
 * One logger for the process. `redact` is belt-and-braces: nothing in this service ever puts
 * a key into a log object, and if someone later does, it will not reach stdout.
 */
export const log = pino({
  level: env.logLevel,
  redact: {
    paths: ['apiKey', 'api_key', 'key', 'authorization', '*.apiKey', '*.api_key', '*.authorization'],
    censor: '[redacted]'
  }
});

/**
 * Provider error bodies go into `trace.error`, which is streamed to the browser. We do not
 * control what a provider puts in its own 4xx body, so anything key-shaped is stripped before
 * it can be logged, streamed, or written to a run log.
 */
const KEY_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{8,}|tvly-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

export const scrub = (text: string): string => text.replace(KEY_SHAPES, '[redacted]');
