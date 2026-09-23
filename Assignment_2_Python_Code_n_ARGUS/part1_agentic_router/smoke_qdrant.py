"""
Smoke test for the Agentic_Router notebook's local Qdrant index + embedding model.

Runs entirely offline — no OpenAI or SerpApi calls. Verifies:
  - the prebuilt Qdrant collections load from Agentic_RAG/qdrant_data
  - the nomic-embed-text-v1.5 model loads and produces an embedding
    (mirrors the notebook's get_text_embeddings cell exactly: no query
    prefix, mean-pool over last_hidden_state, no normalization)
  - both collections return top-3 hits for a sample query
"""
import asyncio
import os

import qdrant_client
from transformers import AutoTokenizer, AutoModel

QDRANT_PATH = os.path.join(os.getcwd(), "Agentic_RAG", "qdrant_data")

COLLECTIONS = ["opnai_data", "10k_data"]

QUERY = "What does the Lyft 10-K say about revenue?"


def get_text_embeddings(text, tokenizer, model):
    """Mirrors the notebook's cell exactly: mean pool over last_hidden_state,
    no prefix, no normalization."""
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True)
    outputs = model(**inputs)
    embeddings = outputs.last_hidden_state.mean(dim=1)
    return embeddings[0].detach().numpy()


async def main():
    print(f"Qdrant path: {QDRANT_PATH}")
    client = qdrant_client.AsyncQdrantClient(path=QDRANT_PATH)

    print("\n=== Collections ===")
    for name in COLLECTIONS:
        info = await client.get_collection(name)
        print(
            f"  {name}: points_count={info.points_count} "
            f"vector_size={info.config.params.vectors.size} "
            f"distance={info.config.params.vectors.distance}"
        )

    print("\n=== Loading nomic-embed-text-v1.5 ===")
    tokenizer = AutoTokenizer.from_pretrained(
        "nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True
    )
    model = AutoModel.from_pretrained(
        "nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True
    )

    print(f"\n=== Embedding query: {QUERY!r} ===")
    query_vec = get_text_embeddings(QUERY, tokenizer, model)
    print(f"  vector shape: {query_vec.shape}")
    print(f"  first 5 dims: {query_vec[:5]}")

    for name in COLLECTIONS:
        print(f"\n=== Top-3 hits: {name} ===")
        hits = await client.query_points(
            collection_name=name,
            query=query_vec,
            limit=3,
        )
        for i, point in enumerate(hits.points):
            content = point.payload.get("content", "")
            snippet = content[:120].replace("\n", " ")
            print(f"  [{i}] score={point.score:.4f} content[:120]={snippet!r}")


if __name__ == "__main__":
    asyncio.run(main())
