#!/usr/bin/env node
/**
 * Regenerate fixtures/bench-60p.pdf with the bench's own generator (benchmark/lib.mjs makePdf),
 * so the file we test against locally is byte-for-byte what bench.mjs uploads during the
 * "ingest during search" phase. Deterministic: same pages → same bytes. Run from Claude_Build/:
 *
 *   node fixtures/make-bench-pdf.mjs            # 60 pages (workload.ingest_during_search_pdf_pages)
 *   node fixtures/make-bench-pdf.mjs 120        # any page count
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pages = Number(process.argv[2] ?? 60);
const { makePdf } = await import(join(here, '..', 'benchmark', 'lib.mjs'));
const buf = makePdf(pages);
const out = join(here, `bench-${pages}p.pdf`);
writeFileSync(out, buf);
console.log(`${out}  ${buf.length} bytes  sha256 ${createHash('sha256').update(buf).digest('hex')}`);
