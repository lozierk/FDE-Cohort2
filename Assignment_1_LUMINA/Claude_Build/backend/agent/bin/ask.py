#!/usr/bin/env python3
# Ask one question through the local gateway and print tools, TTFT, cost, citations.
# Usage: python3 bin/ask.py [--depth quick|deep] [--mode web|docs|auto] [--user ID] [--space ID] "question" out.json
#   (gateway on :8787; defaults X-User-Id kurt-test, mode web, depth quick)
# --space ID puts "spaceId": ID in the ask body — docs-mode questions against a Space.
# On --depth deep it also prints plan latency, the sub-questions, per-sub-question source
# counts and distinct sources — the numbers the deep spec's acceptance step asks for.
import sys,time,json,re,subprocess,urllib.request
args=sys.argv[1:]
depth="quick"; mode="web"; user="kurt-test"; space=None; rest=[]
while args:
    a=args.pop(0)
    if a=="--depth": depth=args.pop(0)
    elif a=="--mode": mode=args.pop(0)
    elif a=="--user": user=args.pop(0)
    elif a=="--space": space=args.pop(0)
    else: rest.append(a)
q=rest[0]; out=rest[1] if len(rest)>1 else "/dev/null"
req=urllib.request.Request("http://localhost:8787/threads",data=json.dumps({"title":q[:40]}).encode(),headers={"content-type":"application/json","X-User-Id":user})
tid=json.load(urllib.request.urlopen(req))["threadId"]
body={"query":q,"mode":mode,"depth":depth}
if space: body["spaceId"]=space
start=time.time(); p=subprocess.Popen(["curl","-sN","-X","POST",f"http://localhost:8787/threads/{tid}/ask","-H","content-type: application/json","-H",f"X-User-Id: {user}","-d",json.dumps(body)],stdout=subprocess.PIPE,text=True)
ev=None; toks=[]; traces=[]; srcs=[]; done=None; ttft=None; plan=None; plan_ms=None; saw_retrieval=False; plan_before=None
RETRIEVAL={"web_search","fetch_page","search_documents"}
for line in p.stdout:
    line=line.rstrip("\n")
    if line.startswith("event:"): ev=line[6:].strip()
    elif line.startswith("data:"):
        try: j=json.loads(line[5:].strip())
        except Exception: continue
        if ev=="token":
            if ttft is None: ttft=time.time()-start
            toks.append(j.get("text",""))
        elif ev=="trace":
            traces.append(j)
            if j.get("tool") in RETRIEVAL: saw_retrieval=True
        elif ev=="plan":
            plan=j; plan_ms=round((time.time()-start)*1000); plan_before=not saw_retrieval
        elif ev=="sources": srcs=j
        elif ev=="done": done=j
        elif ev=="error": done={"error":j}
ans="".join(toks); cites=sorted(set(int(x) for x in re.findall(r"\[(\d+)\]",ans)))
ns={s["n"] for s in srcs}; dangling=[c for c in cites if c not in ns]
distinct=len({s.get("url") or f"{s.get('docId')}:{(s.get('locator') or {}).get('page') or (s.get('locator') or {}).get('heading') or ''}" for s in srcs})
print(f"Q: {q}   [thread {tid}, depth {depth}, mode {mode}, user {user}]")
if plan:
    subs=plan.get("subQuestions",[])
    print(f"  PLAN: {len(subs)} sub-question(s) in {plan_ms}ms | before any retrieval: {plan_before}")
    if plan.get("reason"): print(f"    why: {plan['reason']}")
    for s in subs: print(f"    {s['i']}. {s['question']}\n       reason: {s.get('reason','-')}")
    per_src={}; per_step={}
    for s in srcs: per_src[s.get("subQuestion")]=per_src.get(s.get("subQuestion"),0)+1
    for t in traces:
        if t.get("tool") in RETRIEVAL: per_step[t.get("subQuestion")]=per_step.get(t.get("subQuestion"),0)+1
    print(f"    sources per sub-question: {dict(sorted(per_src.items(),key=lambda kv:(kv[0] is None,kv[0])))}")
    print(f"    retrieval steps per sub-question: {dict(sorted(per_step.items(),key=lambda kv:(kv[0] is None,kv[0])))}")
    untagged_steps=[t["step"] for t in traces if t.get("tool") in RETRIEVAL and not isinstance(t.get("subQuestion"),int)]
    untagged_srcs=[s["n"] for s in srcs if not isinstance(s.get("subQuestion"),int)]
    print(f"    untagged retrieval steps: {untagged_steps or 'none'} | untagged sources: {untagged_srcs or 'none'}")
print(f"  tools: {[t['tool']+('' if t['ok'] else '!') for t in traces]}  | steps {len(traces)} | TTFT {ttft and round(ttft,2)}s | total {round(time.time()-start,2)}s | cost ${done and done.get('costUsd')} | in {done and done.get('tokens',{}).get('in')} | sources {len(srcs)} (distinct {distinct}) | cites {cites} | dangling {dangling}")
print("  A: "+ans.replace("\n"," ")[:420])
json.dump({"q":q,"threadId":tid,"depth":depth,"mode":mode,"plan":plan,"planMs":plan_ms,"planBeforeRetrieval":plan_before,"traces":traces,"sources":srcs,"distinctSources":distinct,"done":done,"answer":ans,"ttft":ttft},open(out,"w"))
