import type { Tool, ToolContext, ToolResult } from './types.js';

/**
 * A per-call backstop around `tool.run`. Only `fetch_page` bounds itself today (an inner 8 s
 * `AbortSignal.timeout`); every other tool can hang until the request's own wall clock gives
 * up. This wraps EVERY dispatch with an outer deadline so a stuck tool becomes a failed step
 * (rule A1: `ok: false` and a non-empty `error`), never a run that never ends.
 *
 * On timeout the tool's own controller is aborted (combined with `ctx.signal`, if any, via
 * `AbortSignal.any`) so a tool honouring `ctx.signal` — `fetch_page` does — stops promptly
 * instead of finishing a fetch nobody will read. A thrown error is NOT caught here: the only
 * dispatch site (`src/loop/research.ts`) already turns a throw into a failed step, and
 * duplicating that here would just be a second place to keep in sync with it.
 */
export async function runWithDeadline(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
  ms: number
): Promise<ToolResult> {
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const runCtx: ToolContext = { ...ctx, signal };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ToolResult>((resolve) => {
    timer = setTimeout(() => {
      // Resolve BEFORE aborting: aborting can synchronously reject `running` (a tool's abort
      // listener rejecting, as `fetch_page`'s underlying fetch does), and Promise.race settles
      // on whichever promise settles first — resolving first is what keeps this deadline's
      // timeout result the one that wins, instead of that rejection racing past it.
      resolve({ ok: false, error: `${tool.name} timed out after ${ms} ms` });
      controller.abort();
    }, ms);
  });

  try {
    const running = tool.run(args, runCtx);
    // A tool that loses the race and later rejects (e.g. it reacted to the abort by throwing)
    // must not become an unhandled rejection once this function has already returned via the
    // deadline branch.
    running.catch(() => {});
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
