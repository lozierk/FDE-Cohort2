import { db } from '../db.js';

/**
 * The deep-search spend gate: `DEEP_DAILY_CAP` deep asks per `X-User-Id` per UTC day.
 *
 * It lives in the agent service and not the gateway because it is a cap on a provider call,
 * and a cap on the edge is one you bypass by reaching the agent service directly.
 *
 * It is a RESERVATION, not a count of what happened. `/stats.deepToday` counts `requests`
 * rows and is the report; this collection is the gate, and the two can legitimately differ by
 * the credits refunded when planning failed before any retrieval.
 */

const COLLECTION = 'deepQuota';

export interface DeepQuotaDoc {
  /** `${userId}:${YYYY-MM-DD}` in UTC — the same day boundary /stats uses. */
  _id: string;
  userId: string;
  count: number;
  /** TTL index target: the row deletes itself two days after the day it governs. */
  expiresAt: Date;
}

const quota = async () => (await db()).collection<DeepQuotaDoc>(COLLECTION);

/** UTC, because the cap is documented per day and a day has to mean one thing for everyone. */
export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);

/** The next UTC midnight, as the ISO string the 429 body hands back to the client. */
export function resetsAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

export async function ensureDeepQuotaIndex(): Promise<void> {
  await (await quota()).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export type Reservation = { ok: true } | { ok: false; resetsAt: string };

/**
 * Take one credit, atomically.
 *
 * `$inc` then compare — rather than read, decide, write — is what makes two concurrent deep
 * asks on the last credit safe: whichever loses sees a count above the cap and gives its
 * credit back. A read-then-write would let both through and the cap would be advisory.
 */
export async function reserveDeep(userId: string, cap: number, now = new Date()): Promise<Reservation> {
  const _id = `${userId}:${utcDay(now)}`;
  // Midnight UTC ending the day after tomorrow (48–72 h out). The row must outlive the day it governs by
  // enough that a clock skew or a slow TTL sweep can never expire a cap still in force.
  const expiresAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3));

  const doc = await (await quota()).findOneAndUpdate(
    { _id },
    { $inc: { count: 1 }, $setOnInsert: { userId, expiresAt } },
    { upsert: true, returnDocument: 'after' }
  );

  if ((doc?.count ?? 1) > cap) {
    await refundDeep(userId, now);
    return { ok: false, resetsAt: resetsAt(now) };
  }
  return { ok: true };
}

/** Give a credit back. Used when planning failed before anything was retrieved. */
export async function refundDeep(userId: string, now = new Date()): Promise<void> {
  await (await quota()).updateOne({ _id: `${userId}:${utcDay(now)}` }, { $inc: { count: -1 } });
}

/** Credits spent today, for tests and for a debug log line. Never a gate on its own. */
export async function deepUsedToday(userId: string, now = new Date()): Promise<number> {
  const doc = await (await quota()).findOne({ _id: `${userId}:${utcDay(now)}` });
  return doc?.count ?? 0;
}
