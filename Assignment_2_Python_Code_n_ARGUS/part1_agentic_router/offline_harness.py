"""Offline harness: runs the notebook's real cells (imports, embeddings, Qdrant,
router, RAG, RBAC) with a FAKE OpenAI client and FAKE SerpApi, then exercises
the new Part 1 + Bonus cells. No network except the HF cache (offline mode)."""
import json, os, re, sys, types
os.environ["HF_HUB_OFFLINE"] = "1"; os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("OPENAI_API_KEY", "fake"); os.environ.setdefault("SERP_API_KEY", "fake")

nb = json.load(open("Agentic_Router.ipynb"))
src = lambda i: "".join(nb["cells"][i]["source"])
def find(marker):
    hits = [i for i, c in enumerate(nb["cells"]) if c["cell_type"] == "code" and marker in "".join(c["source"])]
    assert len(hits) == 1, (marker, hits); return hits[0]

ns = {}
def run(i, label):
    code = "\n".join(l for l in src(i).splitlines() if not l.lstrip().startswith(("!", "%")))
    exec(compile(code, f"cell{i+1}_{label}", "exec"), ns)

# ---- fake OpenAI client -----------------------------------------------------
class _Msg:   
    def __init__(s, c): s.content = c
class _Choice:
    def __init__(s, c): s.message = _Msg(c)
class _Resp:
    def __init__(s, c): s.choices = [_Choice(c)]
CALLS = []
def fake_create(model, messages, **kw):
    p = "\n".join(m["content"] for m in messages); CALLS.append(p[:40]); last = messages[-1]["content"]
    if "subQuestions" in p:
        q = re.search(r'Query: "(.*)"', p, re.S).group(1)
        parts = [s.strip() for s in re.split(r"\band\b(?=\s+what)", q) if s.strip()]
        return _Resp("```json\n" + json.dumps({"subQuestions": parts}) + "\n```")
    if "Keep every citation marker" in p:
        return _Resp("COMPOSED: " + " ".join(re.findall(r"\[\d+\.\d+\]", p)))
    if "Based on the given context" in p:
        return _Resp("Grounded answer [1][2].")
    # router
    text = last.lower()[-160:]   # the user query sits at the end of the router prompt
    if any(k in text for k in ("revenue", "uber", "lyft", "10-k")): a = "10K_DOCUMENT_QUERY"
    elif any(k in text for k in ("agent", "openai", "sdk")): a = "OPENAI_QUERY"
    else: a = "INTERNET_QUERY"
    return _Resp(json.dumps({"action": a, "reason": "fake router", "answer": ""}))
fake_client = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=fake_create)))

# ---- run the notebook's real cells ------------------------------------------
run(find("import requests             # Used"), "imports")
ns["openaiclient"] = fake_client
ns["get_internet_content"] = lambda q, a: f"[Direct Answer] fake web result for: {q}\nSource: https://example.com"
run(find("def route_query"), "router")
ns["openaiclient"] = fake_client                      # router cell may re-create it
run(find("AsyncQdrantClient(path=QDRANT_PATH)"), "qdrant")
run(find("def get_text_embeddings"), "embed")
run(find("def rag_formatted_response"), "rag")
run(find("async def retrieve_and_response"), "retrieve")
run(find("routes = {"), "routes")
run(find("ROLE_PERMISSIONS = {"), "rbac")
run(find("def secure_agentic_rag("), "secure")
ns["openaiclient"] = fake_client
print("router check:", ns["route_query"]("what was uber revenue in 2021?"))

# ---- new cells ---------------------------------------------------------------
run(find("def sub_queries"), "split")
run(find("def agentic_rag_multi"), "partA")
run(find("parse_sub_queries handles"), "partD")
print("\n=== multi: single ==="); r1 = ns["agentic_rag_multi"]("what was uber revenue in 2021?")
n1 = len(CALLS)
print("\n=== multi: two same-route ==="); CALLS.clear(); r2 = ns["agentic_rag_multi"]("what was lyft revenue in 2021 and what was uber revenue in 2021")
print("\n=== multi: two diff-route ==="); CALLS.clear(); r3 = ns["agentic_rag_multi"]("what was uber's 2021 revenue and what are the newest LLMs?")
assert r1.count("[1]") >= 1 and "[1.1]" not in r1.split("── Sources")[0], "single case must keep [n] citations"
assert "[1.1]" in r2 and "[2.1]" in r2 and "COMPOSED" in r2, r2
assert "INTERNET_QUERY" in r3 and "10K_DOCUMENT_QUERY" in r3, r3
print("\n✅ Part 1 offline assertions pass")

run(find("class RoleAwareSemanticCache"), "partE")
run(find("def run_self_check"), "selfcheck")
run(find("run_self_check()\nprint()"), "partF")
# extra: paraphrase within a role should HIT via semantic match
c = ns["RoleAwareSemanticCache"]()
a = ns["secure_agentic_rag_cached"]("bob", "what was uber revenue in 2021?", c)
b = ns["secure_agentic_rag_cached"]("bob", "how much revenue did Uber make in 2021?", c)
print("paraphrase within role:", b["status"], "sim=", b["similarity"])
d = ns["secure_agentic_rag_cached"]("bob", "what were Lyft's operating expenses in 2024?", c)
print("different question, same role/route:", d["status"], "sim=", d["similarity"])
t = ns["secure_agentic_rag_cached"]("alice", "what are the latest LLMs right now?", c)
print("time-sensitive/internet not cached:", t["status"], "cache size", len(c))
