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

Both Dockerfiles copy `tsconfig.base.json` with the root `package.json`: every package's
`tsconfig.json` extends it, and the first remote build (2026-09-15) failed with TS5083 without it.

Expected secrets on the agent: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `OPENAI_API_KEY`,
`MONGODB_URI`, `MONGODB_DB=lumina_claude`, `LLM_MODEL_SYNTHESIS_DEEP=claude-sonnet-5`.
Extra keys from `.env` (e.g. `RATE_LIMIT_PER_MINUTE`) are harmless on the agent.

The app has no public IP: `fly ips list -a lumina-claude-agent` must be empty. Reach it only
as `http://lumina-claude-agent.internal:8000` from inside the org.

## 2. Gateway (public)

```
fly apps create lumina-claude-gateway --org personal
fly deploy -c fly.gateway.toml --remote-only
curl -s https://lumina-claude-gateway.fly.dev/health      # model, search, vector backend, db ok (every other route needs X-User-Id)
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
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("deploy/web/vercel.json","utf8"));delete j._comment;fs.writeFileSync("deploy/web/vercel.json",JSON.stringify(j,null,2)+"\n")'
node -e 'const fs=require("fs");const b=fs.readFileSync("deploy/favicon-kit/android-chrome-192x192.png").toString("base64");fs.writeFileSync("deploy/web/favicon.svg",`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192" width="192" height="192"><image width="192" height="192" xlink:href="data:image/png;base64,${b}"/></svg>`)'
cp deploy/favicon-kit/favicon.ico deploy/web/
cd deploy/web && vercel link --yes --project lumina-claude && vercel --prod --yes
```

Favicon (Kurt, 2026-09-15): the provided `index.html` links `/favicon.svg` by name and type and
cannot be edited, so Kurt's PNG kit (`deploy/favicon-kit/`, committed) is wrapped as an SVG
`<image>` and written over the staged copy only; `web/public/favicon.svg` is untouched.
`favicon.ico` sits at the root for browsers that ask for it unprompted. Cosmetic, and visible
here on purpose.

`deploy/web/` and `.vercel/` are git-ignored. `web/vercel.json` carries the SPA rewrite so a
hard refresh of `/evals` serves `index.html`; its `_comment` key fails Vercel's schema check
("should NOT have additional property"), so the staged copy drops it (the provided file is
untouched). CLI 59 has no `--name`: `vercel link --project` names the project, and `--yes`
makes both steps non-interactive, so nothing here needs Kurt after `vercel login`.
Production URL: **https://lumina-claude.vercel.app** (first deployed 2026-09-15 07:04 ET).

## 4. Bench, export, eval — against the deployed gateway

`eval/eval.mjs` is what the grader runs, and it runs its own benches: gate 2 is a `--smoke`
bench and gate 4 is a full bench, both against `--deploy-url`. So the sequence is eval first,
but gate 3 reads `runs/` from disk BEFORE gate 4's bench runs, so `runs/` must already hold
deployed run logs when `eval.mjs` starts (2026-09-15 09:44 ET: an empty `runs/` failed gate 3
after a green smoke). Export first, eval, export again, then the quality check and the report:

```
mv runs runs.local-$(date +%Y%m%d)        # keep the local evidence; runs/ must hold DEPLOYED runs only
node scripts-local/export-since.mjs --since <deploy time, ISO>            # Mongo `runs` (createdAt ≥ cutoff) → runs/
node scripts-local/sort-failing.mjs       # error runs → runs/failing/ (rule A2)
node eval/eval.mjs --deploy-url https://lumina-claude-gateway.fly.dev     # gates 0–5; ≈ $1.30, ≈ 12 min
node scripts-local/export-since.mjs --since <same cutoff>                 # again: add the eval's own runs
node scripts-local/sort-failing.mjs
node quality/check.mjs .                  # expect 0 errors, 2 warnings (A3 deep fetch thrash, P2)
node eval/build-report.mjs --student "Kurt Lozier" --design DESIGN.md \
  --successful <requestId> --failing <requestId> --notes "…" --video <url> --out reports/report.json
cp reports/report.json reports/latest.json
fly deploy -c fly.gateway.toml --remote-only     # the image carries reports/latest.json; app.ts serves it
```

Why not the provided `scripts/export-runs.mjs`: it dumps the newest 500 runs with no time
filter, so it mixes every earlier local bench into `runs/` and the quality check scores history
(2026-09-15: 500 files, an old capped run tripped A2). `export-since.mjs` writes the same
RunLog shape for runs at or after a cutoff; `--list` prints depth, user, tool names and the
query per run (how to pick the P1 trajectories and to confirm no quick run called
`plan_research`); `--dry-run` counts only. Gate 0 lints the tree, so `eslint.config.mjs`
ignores `deploy/**` and `runs.local-*/**` (the staged UI bundle is one minified line).

A failing run for P1 exists only if the deployed bench produced one; the 2026-09-15 run had
none, so `runs/failing/` carries session 6's `req_793296f3-0fe` from the Mongo `runs`
collection (a real error run of this build). `runs/failing/` is outside the A2 scan.

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
