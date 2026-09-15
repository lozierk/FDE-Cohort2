# DEPLOY — LUMINA, Claude build

Three deployables (TECHNICAL.md Part 4). Decided 2026-09-14 (Kurt: either platform; Claude
recommended, Kurt accepted by running the sequence):

| Piece | Where | Name | Why |
|---|---|---|---|
| Agent | Fly, **private** (6PN only) | `lumina-claude-agent` | Holds every key and the deep cap; forks a worker child, so not a serverless function |
| Gateway | Fly, public | `lumina-claude-gateway` | Long-lived Express: streams SSE, holds a deep ask open ≤ 250 s; a Vercel function could not reach a private Fly agent |
| UI (`web/`, provided) | Vercel, static | `lumina-claude` | **This URL is the submission** (Q-5) |
| Mongo | Atlas `lumina-claude`, db `lumina_claude` | — | Stays put |

No volume on the agent. Every answer is written to the Mongo `runs` collection as well as to
disk; `scripts/export-runs.mjs` (provided) pulls it back to `runs/` for the eval.

All commands run from `Claude_Build/`. Lines marked **Kurt** touch a login or `.env`.

## 0. Logins (once)

```
fly auth login          # Kurt
vercel login            # Kurt
```

## 1. Agent (private)

```
fly apps create lumina-claude-agent --org personal
grep -vE '^\s*(#|$)' .env | fly secrets import -a lumina-claude-agent      # Kurt — imports every key incl. MONGODB_DB, LLM_MODEL_SYNTHESIS_DEEP
fly deploy -c fly.agent.toml --remote-only
fly logs -a lumina-claude-agent      # expect "agent up …" then "jobs worker child started"
```

Expected secrets on the agent: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `OPENAI_API_KEY`,
`MONGODB_URI`, `MONGODB_DB=lumina_claude`, `LLM_MODEL_SYNTHESIS_DEEP=claude-sonnet-5`.
Extra keys from `.env` (e.g. `RATE_LIMIT_PER_MINUTE`) are harmless on the agent.

The app has no public IP: `fly ips list -a lumina-claude-agent` must be empty. Reach it only
as `http://lumina-claude-agent.internal:8000` from inside the org.

## 2. Gateway (public)

```
fly apps create lumina-claude-gateway --org personal
fly deploy -c fly.gateway.toml --remote-only
curl -s https://lumina-claude-gateway.fly.dev/health      # model, search, vector backend, db ok
```

`AGENT_URL` and `RATE_LIMIT_PER_MINUTE=300` are in `fly.gateway.toml`. `CORS_ORIGINS` defaults
to localhost; set it after step 3 gives the UI its URL:

```
fly secrets set CORS_ORIGINS=https://lumina-claude.vercel.app -a lumina-claude-gateway
```

## 3. UI on Vercel (prebuilt static — never edit `web/`)

Build the provided UI locally against the public gateway, then deploy the output from a
scratch folder so Vercel's `.vercel/` link file never lands inside the protected `web/`:

```
npm run build -w @lumina/contract
VITE_API_URL=https://lumina-claude-gateway.fly.dev npm run build -w @lumina/web
rm -rf deploy/web && mkdir -p deploy/web && cp -R web/dist/. deploy/web/ && cp web/vercel.json deploy/web/
cd deploy/web && vercel --prod --yes --name lumina-claude      # Kurt on first run (project link)
```

`deploy/web/` and `.vercel/` are git-ignored. `web/vercel.json` carries the SPA rewrite so a
hard refresh of `/evals` serves `index.html`.

## 4. Bench, export, eval — against the deployed gateway

```
mv runs runs.local-$(date +%Y%m%d)        # keep the local evidence; the eval must read the deployed run
node benchmark/bench.mjs --target https://lumina-claude-gateway.fly.dev
node scripts/export-runs.mjs              # Mongo `runs` → runs/<requestId>.json (uses MONGODB_DB from .env)
node scripts-local/sort-failing.mjs       # error runs → runs/failing/ (the export puts everything in runs/; rule A2)
node quality/check.mjs .
node eval/eval.mjs --deploy-url https://lumina-claude-gateway.fly.dev
node eval/build-report.mjs --successful <requestId> --failing <requestId>
```

Then open `https://lumina-claude.vercel.app/evals` and read every number against `reports/`.

## Gotchas

- `fly deploy` builds from `Claude_Build/` because both services depend on the workspace package
  `@lumina/contract`; the Dockerfiles compile it inside the image. `.dockerignore` keeps
  `.env`, `runs/`, `reports/` and `fixtures/` out of the context.
- The agent's `/health` pings the providers, so its Fly check is TCP, not HTTP. The gateway's
  HTTP check exercises the chain.
- `auto_stop_machines = "off"` on the gateway: the bench times TTFT, and a machine cold start
  is not the app. Stop both apps after submission grading if cost matters (`fly scale count 0`).
- Deep credits are per `X-User-Id` per UTC day; the bench uses a fresh deep user per run.
