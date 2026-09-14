import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

// Set before anything imports env.ts. No MONGODB_URI, so db.ts takes its in-memory fallback
// and the vector backend is `mongo-cosine-scan` — which is also the probe path these tests
// exercise, because an in-memory mongod has no Atlas Search index to probe.
process.env.RUNS_DIR = mkdtempSync(join(tmpdir(), 'lumina-runs-'));
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.LLM_PROVIDER = 'fake';

const CORPUS = resolve(import.meta.dirname, '../../../eval/gold/corpus');
const PAGES = JSON.parse(readFileSync(resolve(CORPUS, '../pages.json'), 'utf8')) as {
  documents: Record<string, { kind: string; pages?: { page: number }[] }>;
};

const { newId } = await import('@lumina/contract');
const { parse, parseMarkdown, parseText, kindOf } = await import('../src/ingest/parse.js');
const { chunk } = await import('../src/ingest/chunk.js');
const { probe } = await import('../src/ingest/probe.js');
const { indexDocument, chunkId } = await import('../src/ingest/index-document.js');
const { FakeEmbedder } = await import('../src/providers/fake-embeddings.js');
const { putFile } = await import('../src/store/gridfs.js');
const store = await import('../src/store/index.js');
const { closeDb } = await import('../src/db.js');
const { default: pino } = await import('pino');

const log = pino({ level: 'silent' });
const embedder = new FakeEmbedder();

before(async () => {
  await store.ensureIndexes();
});

after(async () => {
  await closeDb();
});

/** Put a real corpus file through the same path an upload takes, then index it. */
async function ingest(filename: string, mimeType: string, userId = 'dev'): Promise<{ docId: string; spaceId: string }> {
  const space = await store.createSpace(userId, `space for ${filename}`);
  const buffer = readFileSync(join(CORPUS, filename));
  const docId = newId('doc');
  const fileId = await putFile(buffer, filename, mimeType, { docId, spaceId: space._id, userId });
  await store.insertDocument({
    _id: docId,
    spaceId: space._id,
    userId,
    title: filename,
    mimeType,
    bytes: buffer.byteLength,
    status: 'pending',
    pct: 0,
    fileId,
    createdAt: new Date()
  });
  return { docId, spaceId: space._id };
}

// ---------------------------------------------------------------- parse

test('parse() on a PDF yields one unit per page, with the page count pages.json declares', async () => {
  const buffer = readFileSync(join(CORPUS, 'retrieval-basics.pdf'));
  const units = await parse(buffer, 'application/pdf', 'retrieval-basics.pdf');

  const declared = PAGES.documents['retrieval-basics.pdf']?.pages?.length;
  assert.equal(units.length, declared, `pdfjs found ${units.length} pages, pages.json declares ${declared}`);
  assert.deepEqual(
    units.map((u) => u.locator.page),
    [1, 2, 3, 4],
    'locators are 1-based page numbers, in order'
  );
  assert.ok(
    units[0]!.text.includes('The common default is 1.2'),
    'page 1 carries the g01 anchor, so a page-1 citation is honest'
  );
  for (const u of units) assert.ok(u.text.trim().length > 0, 'no empty page unit is emitted');
});

test('parse() on the second PDF also matches pages.json', async () => {
  const buffer = readFileSync(join(CORPUS, 'vector-search-on-mongodb.pdf'));
  const units = await parse(buffer, 'application/pdf', 'vector-search-on-mongodb.pdf');
  assert.equal(units.length, PAGES.documents['vector-search-on-mongodb.pdf']?.pages?.length);
});

test('parse() on Markdown splits on headings and keeps the heading line with its section', async () => {
  const buffer = readFileSync(join(CORPUS, 'agent-loops-and-failure.md'));
  const units = await parse(buffer, 'text/markdown', 'agent-loops-and-failure.md');

  // Whitespace-normalized, the way the bench compares a gold anchor against a snippet: the
  // source wraps this phrase across two lines.
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  const bounded = units.find((u) => flat(u.text).includes('three values, set explicitly at the call site'));
  assert.ok(bounded, 'the g27 anchor phrase survived parsing');
  assert.equal(bounded!.locator.heading, 'Bounded, or not a loop');
  assert.ok(bounded!.text.startsWith('## Bounded, or not a loop'), 'the heading line stays as the first line');
  for (const u of units) assert.ok(u.locator.heading, 'every markdown unit carries a heading locator');
});

test('parseMarkdown: text before the first heading is located by the filename, and a # inside a fence is not a heading', () => {
  const units = parseMarkdown(
    ['Preamble prose.', '', '```sh', '# not a heading, a shell comment', '```', '', '## Real heading', 'Body.'].join('\n'),
    'notes.md'
  );
  assert.equal(units.length, 2);
  assert.equal(units[0]!.locator.heading, 'notes.md');
  assert.ok(units[0]!.text.includes('# not a heading'), 'the fenced hash stayed inside the first unit');
  assert.equal(units[1]!.locator.heading, 'Real heading');
});

test('parseText locates windows by their first 1-based line, and kindOf reads mime or extension', () => {
  const units = parseText(Array.from({ length: 400 }, (_, i) => `line ${i + 1} of a plain text file`).join('\n'));
  assert.ok(units.length > 1, 'a long text file is more than one unit');
  assert.equal(units[0]!.locator.line, 1);
  assert.ok((units[1]!.locator.line ?? 0) > 1, 'the second window starts at a later line');

  assert.equal(kindOf('application/pdf', 'x'), 'pdf');
  assert.equal(kindOf('application/octet-stream', 'x.pdf'), 'pdf');
  assert.equal(kindOf('text/markdown', 'x'), 'markdown');
  assert.equal(kindOf('application/octet-stream', 'x.md'), 'markdown');
  assert.equal(kindOf('text/plain', 'x.txt'), 'text');
});

// ---------------------------------------------------------------- chunk

test('chunk() never crosses a unit, respects the overlap, and drops empties', async () => {
  const buffer = readFileSync(join(CORPUS, 'retrieval-basics.pdf'));
  const units = await parse(buffer, 'application/pdf', 'retrieval-basics.pdf');
  const drafts = chunk(units);

  assert.ok(drafts.length >= units.length, 'at least one chunk per page');
  assert.deepEqual(
    drafts.map((d) => d.ord),
    drafts.map((_, i) => i),
    'ord increments across the whole document with no gaps'
  );

  for (const d of drafts) {
    assert.ok(d.text.trim().length > 0, 'no whitespace-only chunk survives');
    assert.ok(d.locator.page, 'every chunk inherits its page');
    // The proof that a chunk never crosses a page: its text is contained in exactly the page
    // it claims, after whitespace normalization.
    const page = units.find((u) => u.locator.page === d.locator.page);
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    assert.ok(flat(page!.text).includes(flat(d.text)), `chunk ${d.ord} is inside page ${d.locator.page}`);
  }

  // Consecutive chunks of the same page overlap: the tail of one reappears at the head of the
  // next, which is what keeps a fact split across a boundary whole somewhere.
  const perPage = drafts.filter((d) => d.locator.page === 1);
  if (perPage.length > 1) {
    const a = perPage[0]!.text;
    const b = perPage[1]!.text;
    const tail = a.slice(-40).replace(/\s+/g, ' ').trim();
    assert.ok(
      b.replace(/\s+/g, ' ').includes(tail.slice(0, 20)),
      'the next chunk of the same page starts inside the previous one'
    );
  }
});

test('chunk() keeps a short unit whole and splits a long one at a sentence end', () => {
  const short = chunk([{ text: 'One short section.', locator: { heading: 'h' } }]);
  assert.equal(short.length, 1);
  assert.equal(short[0]!.text, 'One short section.');

  const sentence = 'This is a sentence of a length that makes the arithmetic easy to follow. ';
  const long = chunk([{ text: sentence.repeat(40), locator: { page: 7 } }]);
  assert.ok(long.length > 1, 'a 2,900-char unit is more than one chunk');
  for (const d of long) {
    assert.equal(d.locator.page, 7);
    assert.ok(d.text.length <= 1000 + 150, `chunk of ${d.text.length} chars stays within size + overlap`);
  }
  assert.ok(/\.$/.test(long[0]!.text), 'the first chunk ends at a sentence end');
});

// ---------------------------------------------------------------- indexDocument

test('indexDocument() takes a Markdown file to indexed, with deterministic chunk ids', async () => {
  const { docId, spaceId } = await ingest('agent-loops-and-failure.md', 'text/markdown');
  const result = await indexDocument({ docId, spaceId, userId: 'dev', embedder, log });

  assert.ok(result.chunks > 0, 'chunks were written');
  assert.equal(result.pages, undefined, 'a markdown file has no page count');
  assert.equal(result.probeAttempts, 1, 'the cosine-scan probe succeeds on the first look');

  const row = await store.getDocument(docId);
  assert.equal(row!.status, 'indexed');
  assert.equal(row!.pct, 100);
  assert.equal(row!.chunks, result.chunks);
  assert.equal(row!.error, undefined, 'an indexed document carries no error string');

  const rows = await (await store.chunks()).find({ docId }).sort({ ord: 1 }).toArray();
  assert.equal(rows.length, result.chunks);
  for (const c of rows) {
    assert.equal(c._id, chunkId(docId, c.ord), 'the id is `${docId}:${ord}`, not a uuid');
    assert.equal(c.embedding.length, 1536);
    assert.equal(c.spaceId, spaceId);
    assert.ok(c.locator.heading, 'the locator survived into the stored chunk');
  }
});

test('indexDocument() run twice upserts rather than duplicating', async () => {
  const { docId, spaceId } = await ingest('streaming-and-latency.md', 'text/markdown');
  const first = await indexDocument({ docId, spaceId, userId: 'dev', embedder, log });
  const second = await indexDocument({ docId, spaceId, userId: 'dev', embedder, log });

  assert.equal(second.chunks, first.chunks, 'the same chunk count after a retry');
  assert.equal(await store.countChunks(docId), first.chunks);
  assert.equal(
    second.embedTokens,
    0,
    'the second run re-embedded nothing: finished work is not re-run after a crash'
  );
});

test('indexDocument() on a PDF records the page count and page locators', async () => {
  const { docId, spaceId } = await ingest('retrieval-basics.pdf', 'application/pdf');
  const result = await indexDocument({ docId, spaceId, userId: 'dev', embedder, log });

  assert.equal(result.pages, PAGES.documents['retrieval-basics.pdf']?.pages?.length);
  const row = await store.getDocument(docId);
  assert.equal(row!.status, 'indexed');
  assert.equal(row!.pages, result.pages);

  const page1 = await (await store.chunks()).find({ docId, 'locator.page': 1 }).sort({ ord: 1 }).toArray();
  assert.equal(page1[0]!.ord, 0, 'page 1 owns the first chunks of the document');
  assert.ok(
    page1.some((c) => c.text.includes('The common default is 1.2')),
    'a page-1 chunk holds the g01 anchor, so a `locator.page === 1` citation for it is honest'
  );
});

test('a corrupt PDF throws, and the document it belonged to can be failed with that message', async () => {
  const userId = 'dev';
  const space = await store.createSpace(userId, 'corrupt');
  const docId = newId('doc');
  const junk = Buffer.from('%PDF-1.4\nthis is not actually a pdf at all\n%%EOF\n', 'latin1');
  const fileId = await putFile(junk, 'broken.pdf', 'application/pdf', { docId, spaceId: space._id, userId });
  await store.insertDocument({
    _id: docId,
    spaceId: space._id,
    userId,
    title: 'broken.pdf',
    mimeType: 'application/pdf',
    bytes: junk.byteLength,
    status: 'pending',
    pct: 0,
    fileId,
    createdAt: new Date()
  });

  // Fails loud: the job body throws rather than marking a document with no text `indexed`.
  const err = await indexDocument({ docId, spaceId: space._id, userId, embedder, log }).then(
    () => null,
    (e: Error) => e
  );
  assert.ok(err, 'indexDocument threw');
  assert.ok(err!.message.trim().length > 0, 'the error string is non-empty');

  // This is what worker.ts does with it, and what the document row must end up saying.
  await store.updateDocumentStatus(docId, { status: 'failed', pct: 100, error: err!.message });
  const row = await store.getDocument(docId);
  assert.equal(row!.status, 'failed');
  assert.ok((row!.error ?? '').length > 0, 'the failure reason reached the row a user can see');
});

test('a document with no extractable text fails rather than indexing empty', async () => {
  const userId = 'dev';
  const space = await store.createSpace(userId, 'empty');
  const docId = newId('doc');
  const empty = Buffer.from('   \n\n  \n', 'utf8');
  const fileId = await putFile(empty, 'empty.txt', 'text/plain', { docId, spaceId: space._id, userId });
  await store.insertDocument({
    _id: docId,
    spaceId: space._id,
    userId,
    title: 'empty.txt',
    mimeType: 'text/plain',
    bytes: empty.byteLength,
    status: 'pending',
    pct: 0,
    fileId,
    createdAt: new Date()
  });

  await assert.rejects(
    indexDocument({ docId, spaceId: space._id, userId, embedder, log }),
    /no text could be extracted/
  );
});

// ---------------------------------------------------------------- probe

test('probe() fails loudly, with a named backoff, when the chunk never becomes visible', async () => {
  const phantom = {
    _id: 'doc_phantom:0',
    docId: 'doc_phantom',
    spaceId: 'spc_phantom',
    userId: 'dev',
    text: 'nothing was ever written for this chunk',
    locator: { page: 1 },
    ord: 0,
    embedding: (await embedder.embed(['phantom']))[0]!,
    createdAt: new Date()
  };
  // A one-step backoff keeps the test fast; the production value is ~63 s of patience.
  await assert.rejects(probe(phantom, { backoffSec: [0] }), /read-your-write probe failed/);
});
