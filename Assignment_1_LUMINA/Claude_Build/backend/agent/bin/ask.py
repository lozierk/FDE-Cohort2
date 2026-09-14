#!/usr/bin/env python3
# Ask one question through the local gateway and print tools, TTFT, cost, citations.
# Usage: python3 bin/ask.py "question" out.json   (gateway on :8787; X-User-Id kurt-test; mode web, depth quick)
import sys,time,json,re,subprocess,urllib.request
q=sys.argv[1]; out=sys.argv[2]
req=urllib.request.Request("http://localhost:8787/threads",data=json.dumps({"title":q[:40]}).encode(),headers={"content-type":"application/json","X-User-Id":"kurt-test"})
tid=json.load(urllib.request.urlopen(req))["threadId"]
start=time.time(); p=subprocess.Popen(["curl","-sN","-X","POST",f"http://localhost:8787/threads/{tid}/ask","-H","content-type: application/json","-H","X-User-Id: kurt-test","-d",json.dumps({"query":q,"mode":"web","depth":"quick"})],stdout=subprocess.PIPE,text=True)
ev=None; toks=[]; traces=[]; srcs=[]; done=None; ttft=None
for line in p.stdout:
    line=line.rstrip("\n")
    if line.startswith("event:"): ev=line[6:].strip()
    elif line.startswith("data:"):
        try: j=json.loads(line[5:].strip())
        except Exception: continue
        if ev=="token":
            if ttft is None: ttft=time.time()-start
            toks.append(j.get("text",""))
        elif ev=="trace": traces.append(j)
        elif ev=="sources": srcs=j
        elif ev=="done": done=j
        elif ev=="error": done={"error":j}
ans="".join(toks); cites=sorted(set(int(x) for x in re.findall(r"\[(\d+)\]",ans)))
ns={s["n"] for s in srcs}; dangling=[c for c in cites if c not in ns]
print(f"Q: {q}")
print(f"  tools: {[t['tool']+('' if t['ok'] else '!') for t in traces]}  | TTFT {ttft and round(ttft,2)}s | total {round(time.time()-start,2)}s | cost ${done and done.get('costUsd')} | in {done and done.get('tokens',{}).get('in')} | sources {len(srcs)} | cites {cites} | dangling {dangling}")
print("  A: "+ans.replace("\n"," ")[:420])
json.dump({"q":q,"traces":traces,"sources":srcs,"done":done,"answer":ans,"ttft":ttft},open(out,"w"))
