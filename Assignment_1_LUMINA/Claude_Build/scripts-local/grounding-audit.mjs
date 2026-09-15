#!/usr/bin/env node
/**
 * Re-score citation grounding the way benchmark/bench.mjs does, over the latest stored
 * answers, and say WHICH citations fail and why. OURS, not provided; imports the bench's own
 * matcher so the verdict is the bench's verdict.
 *
 *   node scripts-local/grounding-audit.mjs [--limit 60] [--user bench]
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snippetIsGrounded, normalize } from '../benchmark/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const limit = Number(arg('limit', 60));
const user = arg('user', null);

// Verbatim from benchmark/bench.mjs, so the haystack is the bench's haystack.
const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');

const pageCache = new Map();
async function fetchPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  let out = { status: 0, text: null, bytes: 0 };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'lumina-bench/0.1 (+course benchmark)' },
      signal: AbortSignal.timeout(12000)
    });
    const body = await res.text();
    out = { status: res.status, text: res.ok ? stripHtml(body) : null, bytes: body.length };
  } catch (err) {
    out = { status: 0, text: null, bytes: 0, err: err.message };
  }
  pageCache.set(url, out);
  return out;
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? 'lumina');
const filter = { role: 'assistant', 'sources.0': { $exists: true } };
if (user) filter.userId = user;
const msgs = await db.collection('messages').find(filter, { sort: { createdAt: -1 }, limit }).toArray();
await client.close();

console.log(`answers: ${msgs.length}; fields: ${Object.keys(msgs[0] ?? {}).join(' ')}`);

const cited = (text) => new Set([...String(text).matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])));
const tally = { checked: 0, grounded: 0, unverifiable: 0, ungrounded: 0, dangling: 0, doc: 0 };
const failures = [];

for (const m of msgs) {
  const text = m.content ?? m.text ?? '';
  const byN = new Map(m.sources.map((s) => [s.n, s]));
  for (const n of cited(text)) {
    const s = byN.get(n);
    if (!s) {
      tally.dangling++;
      continue;
    }
    if (s.kind === 'doc') {
      tally.doc++;
      continue;
    }
    tally.checked++;
    const page = await fetchPage(s.url);
    if (!page.text) {
      tally.unverifiable++;
      failures.push({ why: `unverifiable (${page.status || page.err})`, url: s.url, snippet: s.snippet.slice(0, 80) });
      continue;
    }
    if (snippetIsGrounded(s.snippet, page.text)) {
      tally.grounded++;
      continue;
    }
    tally.ungrounded++;
    const hay = normalize(page.text);
    const toks = normalize(s.snippet).split(' ').filter(Boolean);
    // How much of the snippet IS there? Longest run of consecutive snippet tokens found.
    let best = 0;
    for (let i = 0; i < toks.length; i++) {
      for (let len = best + 1; i + len <= toks.length; len++) {
        if (hay.includes(toks.slice(i, i + len).join(' '))) best = len;
        else break;
      }
    }
    const marker = /enable javascript|just a moment|cloudflare|access denied|verify you are human|consent|cookie/i.test(page.text.slice(0, 4000))
      ? 'looks like a wall'
      : '';
    failures.push({
      why: `ungrounded: longest run ${best}/${toks.length} tokens, page ${Math.round(page.bytes / 1024)} KB ${marker}`,
      url: s.url,
      snippet: s.snippet.slice(0, 80)
    });
  }
}

const verifiable = tally.checked - tally.unverifiable;
console.log(JSON.stringify(tally));
console.log(`bench-style rate: ${tally.grounded}/${verifiable} = ${(tally.grounded / Math.max(1, verifiable)).toFixed(3)}`);
console.log('--- failures by host');
const byHost = new Map();
for (const f of failures) {
  const h = new URL(f.url).host;
  byHost.set(h, (byHost.get(h) ?? 0) + 1);
}
for (const [h, c] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(c).padStart(3)}  ${h}`);
console.log('--- failures');
for (const f of failures) console.log(`${f.why}\n    ${f.url}\n    "${f.snippet}"`);
