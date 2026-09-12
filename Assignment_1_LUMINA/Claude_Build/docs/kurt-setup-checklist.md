# Setup checklist for Kurt — keys and Atlas (target: 2026-09-12)

Everything below lands in one file: `Claude_Build/.env` (git-ignored). Start from
`cp .env.example .env` in `Claude_Build/`, then set these lines. Leave the rest at defaults.

## 1. Anthropic (LLM) — needed first
```
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-...
```
Console: console.anthropic.com → API keys → create key, name it `lumina-claude-build`.

## 2. Tavily (web search) — needed first
```
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
```
app.tavily.com → API keys. Free tier is 1,000 credits/month; one search is one credit.

## 3. OpenAI (embeddings only; needed for memory and documents)
```
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```
platform.openai.com → API keys. Cost is negligible ($0.02 per million tokens).

## 4. MongoDB Atlas (needed for memory, documents, and any deployed run)
Per decision D-9: one Atlas project for the Claude build, one free M0 cluster.
1. cloud.mongodb.com → New project `lumina-claude` → Build a cluster → **M0 Free**,
   provider/region: AWS us-east-1 (closest to you and to Fly's `iad`).
2. Security → Database Access → add user `lumina` with a generated password, role
   "Read and write to any database". Save the password somewhere safe; it goes in the URI.
3. Security → Network Access → add `0.0.0.0/0` (needed for Fly later; fine for a demo).
4. Connect → Drivers → copy the `mongodb+srv://...` string, put the password in.
```
MONGODB_URI=mongodb+srv://lumina:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=lumina_claude
VECTOR_BACKEND=atlas-vector-search
```
5. From `Claude_Build/`, run the provided index script, then wait for the search indexes
   to become queryable (they build asynchronously; usually a few minutes):
```
node scripts/create-indexes.mjs
node scripts/create-indexes.mjs --status
```

## Until keys exist
The agent runs locally with no `.env` at all: fake LLM, fake search, in-memory Mongo.
```
LLM_PROVIDER=fake SEARCH_PROVIDER=fake npm run dev
```
Health reports `mongo-cosine-scan` and the fake providers by name, so nothing pretends.

## Not yet: Vercel and Fly.io
Week 2. Both are free-tier; Fly needs a card on file. Nothing to do today.
