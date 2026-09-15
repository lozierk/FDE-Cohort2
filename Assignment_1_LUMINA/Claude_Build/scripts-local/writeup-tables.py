#!/usr/bin/env python3
"""Print the write-up's 'What was measured' tables from a report.json (default reports/latest.json).
Usage: python3 scripts-local/writeup-tables.py [reports/latest.json]"""
import json, sys, datetime, re
p = sys.argv[1] if len(sys.argv) > 1 else 'reports/latest.json'
r = json.load(open(p))
b, q, rub = r['bench'], r['quality'], r['rubric']
ran = datetime.datetime.fromisoformat(b['ranAt'].replace('Z', '+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=-4)))
def fmt(v, unit):
    if v is None: return 'n/a'
    if unit == 'ms': return f'{v:,.0f} ms'
    if unit == 's': return f'{v:.1f} s'
    if unit == '$': return f'${v:.4f}' if v < 0.01 else f'${v:.3f}'
    if unit == '%': return f'{v:.0f} %'
    if unit == '×': return f'{v:.2f}×'
    return f'{v:g}'
passed = sum(1 for s in b['sla'] if s['pass'])
print(f"**Deployed bench, the grader's path.** `eval/eval.mjs --deploy-url {b['target']}`, {b.get('answers','?')} answers, finished {ran:%Y-%m-%d %H:%M} ET. {passed} of {len(b['sla'])} pass.\n")
print('| Gate | Target | Measured | Result |\n|---|---|---|---|')
for s in b['sla']:
    tgt = f"{s['comparator']} {fmt(s['target'], s['unit'])}" if s['unit'] else f"{s['comparator']} {s['target']:g}"
    res = 'Pass' if s['pass'] else 'Fail, documented below'
    print(f"| {s['metric']} | {tgt} | {fmt(s['actual'], s['unit'])} | {res} |")
print('\n### Behavioral gates\n')
rows = []
for row in rub['automated']:
    for part in re.split(r' · (?=[✓✗])', row['evidence']):
        part = part.strip()
        ok = part.startswith('✓'); label = part.lstrip('✓✗ ').strip()
        rows.append((label, 'Pass' if ok else 'Fail'))
print(f"**Rubric evidence, same run.** {sum(1 for _,x in rows if x=='Pass')} of {len(rows)} pass; automated {rub['awarded']}/{sum(x['points'] for x in rub['automated'])}.\n")
print('| Check | Result |\n|---|---|')
for label, res in rows: print(f'| {label} | {res} |')
warn = [x['id'] for x in q['results'] if x['status']=='fail' and x['severity']=='warn']
err = [x['id'] for x in q['results'] if x['status']=='fail' and x['severity']=='error']
print(f"\n**Quality check** (`node quality/check.mjs .`): {q['errors']} errors, {q['warnings']} warnings over {q['runs']} runs" + (f" ({', '.join(warn)})." if warn else '.') + (f" ERRORS: {err}" if err else ''))
