import { Router } from 'express';
import { StatsResponse } from '@lumina/contract';
import { env } from '../env.js';
import { messages, requests } from '../store/index.js';
import { requireUser } from './context.js';

/**
 * Computed from what is on disk, never from a counter in memory: the bench cross-checks
 * `/stats.answers` against the answers it just watched, and an in-process counter resets on
 * every deploy and quietly disagrees.
 *
 * Two sources because the contract puts the numbers in two places. `requests` is the ledger
 * (counts, cost, depth). `messages` carries each answer's own `done` event, which is where
 * `ttftMs` and `searchCached` live — the same fields the bench reads off the stream, so the
 * two measurements cannot drift apart by construction.
 */
export const statsRoutes = Router();

statsRoutes.get('/stats', requireUser, async (req, res, next) => {
  try {
    const userId = req.userId!;
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const rows = await (await requests()).find({ userId }).sort({ createdAt: -1 }).limit(5000).toArray();
    const answers = rows.filter((r) => r.route.endsWith('/ask'));
    const today = answers.filter((r) => new Date(r.createdAt).getTime() >= startOfUtcDay.getTime());

    const answered = await (await messages())
      .find({ userId, role: 'assistant', done: { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(5000)
      .toArray();

    const dones = answered.map((m) => m.done!).filter(Boolean);
    const cacheable = dones.filter((d) => typeof d.searchCached === 'boolean');
    const hitRate = cacheable.length
      ? (cacheable.filter((d) => d.searchCached).length / cacheable.length) * 100
      : 0;

    res.json(
      StatsResponse.parse({
        requests: rows.length,
        answers: answers.length,
        searchCacheHitRatePct: Number(hitRate.toFixed(1)),
        ttftP95Ms: percentile(dones.map((d) => d.ttftMs).filter((n) => Number.isFinite(n)), 95),
        costUsdToday: Number(today.reduce((sum, r) => sum + (r.costUsd ?? 0), 0).toFixed(6)),
        deepToday: today.filter((r) => r.depth === 'deep').length,
        deepDailyCap: env.deepDailyCap
      })
    );
  } catch (err) {
    next(err);
  }
});

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}
