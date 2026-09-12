/**
 * LUMINA gateway entrypoint. All route/middleware logic lives in app.ts so tests can
 * import the express app and .listen(0) it themselves against a stub agent, without this
 * file's .listen() firing during a test run.
 */
import { app, log } from './app.js';
import { env } from './env.js';

app.listen(env.port, () => {
  log.info(
    { port: env.port, agentUrl: env.agentUrl, cors: env.corsOrigins },
    'gateway up'
  );
});
