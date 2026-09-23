# Part 1 — Agentic Router

Local runnable workspace for the course's `Agentic_Router.ipynb` (agentic RAG router:
OpenAI docs / 10-K filings / live internet search).

## Setup

1. **API keys** — copy the example env file and fill in your own keys (never commit `.env`):
   ```bash
   cp .env.example .env
   # then edit .env and set:
   #   OPENAI_API_KEY=sk-...
   #   SERP_API_KEY=...
   ```

2. **Python env** — already created with `uv`. To recreate from scratch:
   ```bash
   uv venv --python 3.11 .venv
   uv pip install --python .venv/bin/python \
     openai qdrant-client "transformers==4.48.0" torch einops \
     python-dotenv nest_asyncio requests matplotlib jupyter ipykernel
   .venv/bin/python -m ipykernel install --user --name a2-part1
   ```

3. **Launch Jupyter** and select the `a2-part1` kernel:
   ```bash
   source .venv/bin/activate
   jupyter notebook Agentic_Router.ipynb
   # In the notebook: Kernel -> Change Kernel -> a2-part1
   ```

## Vector data (`Agentic_RAG/`)

`Agentic_RAG/` holds the prebuilt Qdrant index (`qdrant_data/`, collections
`opnai_data` and `10k_data`) the notebook reads from `./Agentic_RAG/qdrant_data`.
It is **not** committed (see `.gitignore`) — it's ~14 MB and fully reproducible from
the course repo. To re-fetch it:

```bash
tmpdir=$(mktemp -d)
git clone --filter=blob:none --sparse --depth 1 \
  https://github.com/hamzafarooq/multi-agent-course.git "$tmpdir"
git -C "$tmpdir" sparse-checkout set \
  "modules/Module_3_Production_Agentic_RAG_AI_Systems/Agentic_RAG"
cp -R "$tmpdir/modules/Module_3_Production_Agentic_RAG_AI_Systems/Agentic_RAG" ./Agentic_RAG
rm -rf "$tmpdir"
```

## Smoke test (no API keys needed)

`smoke_qdrant.py` verifies the Qdrant index and the embedding model work locally,
without calling OpenAI or SerpApi:

```bash
.venv/bin/python smoke_qdrant.py
```

It prints both collections' point counts and vector size, embeds a sample query with
`nomic-ai/nomic-embed-text-v1.5` (mirroring the notebook's embedding cell exactly —
no prefix, mean pooling over `last_hidden_state`), and shows the top-3 hits from each
collection.

## Offline verification (no API keys, no tokens)

`offline_harness.py` executes the notebook's real cells (embeddings, Qdrant,
router parsing, RBAC) with a fake OpenAI client and fake SerpApi, then runs the
Part 1 and Bonus cells including the leak self-check:

```bash
.venv/bin/python offline_harness.py
```

Use it to prove the logic before spending tokens on the end-to-end run.
