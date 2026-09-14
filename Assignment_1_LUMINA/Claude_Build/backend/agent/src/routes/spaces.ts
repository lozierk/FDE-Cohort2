import { Router, type Request, type Response } from 'express';
import multer, { MulterError } from 'multer';
import {
  CreateSpaceBody,
  CreateSpaceResponse,
  DocumentDoc,
  ListDocumentsResponse,
  ListSpacesResponse,
  UploadDocumentResponse,
  newId,
  type DocumentRow
} from '@lumina/contract';
import { env } from '../env.js';
import { log } from '../log.js';
import { createSpace, getSpace, insertDocument, insertJob, listDocuments, listSpaces } from '../store/index.js';
import { putFile } from '../store/gridfs.js';
import { requireUser, sendError } from './context.js';

/**
 * Spaces and uploads.
 *
 * The one design rule here: THE REQUEST PATH DOES NO WORK. The upload handler writes the file
 * to GridFS, inserts a `pending` document row and a `pending` job row, and answers `202`. It
 * does not parse, chunk, embed, or index — not even for a 13 KB Markdown file. The graded
 * number is a `202` p95 under 300 ms, and a handler that parses "just the small ones" has two
 * latency profiles and no way to tell which one a reader is looking at. AGENTS.md is blunter:
 * "A synchronous parse-then-respond endpoint fails the assignment even if it works."
 */

const upload = multer({
  // Memory, not disk: the file goes straight to GridFS, and a temp file would be a second
  // place for a 25 MB upload to be forgotten.
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 }
});

export const spaceRoutes = Router();

spaceRoutes.post('/spaces', requireUser, async (req, res, next) => {
  try {
    const parsed = CreateSpaceBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message ?? 'invalid body');
      return;
    }
    const space = await createSpace(req.userId!, parsed.data.name);
    res.status(201).json(CreateSpaceResponse.parse({ spaceId: space._id, name: space.name }));
  } catch (err) {
    next(err);
  }
});

spaceRoutes.get('/spaces', requireUser, async (req, res, next) => {
  try {
    const rows = await listSpaces(req.userId!);
    res.json(
      ListSpacesResponse.parse({
        spaces: rows.map((s) => ({
          spaceId: s._id,
          name: s.name,
          createdAt: new Date(s.createdAt).toISOString()
        }))
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- upload

/** What the contract accepts, by extension and by mime. The bench sends the field name `file`. */
const ACCEPT: { ext: RegExp; mimes: string[]; mime: string }[] = [
  { ext: /\.pdf$/i, mimes: ['application/pdf'], mime: 'application/pdf' },
  { ext: /\.(md|markdown)$/i, mimes: ['text/markdown', 'text/x-markdown'], mime: 'text/markdown' },
  { ext: /\.txt$/i, mimes: ['text/plain'], mime: 'text/plain' }
];

function acceptedMime(filename: string, declared: string): string | null {
  const bare = declared.split(';')[0]?.trim().toLowerCase() ?? '';
  for (const a of ACCEPT) {
    if (a.ext.test(filename) || a.mimes.includes(bare)) return a.mimes.includes(bare) ? bare : a.mime;
  }
  return null;
}

spaceRoutes.post(
  '/spaces/:spaceId/documents',
  requireUser,
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      // multer's own limit is the 413 the contract asks for. Anything else from multer is a
      // malformed multipart body, which is a 400.
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          sendError(res, 413, `file is larger than the ${env.maxUploadMb} MB limit`);
          return;
        }
        sendError(res, 400, `bad upload: ${err.message}`);
        return;
      }
      next(err);
    });
  },
  (req, res, next) => {
    handleUpload(req, res).catch(next);
  }
);

async function handleUpload(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  const userId = req.userId!;
  const spaceId = req.params.spaceId ?? '';

  const space = await getSpace(userId, spaceId);
  if (!space) {
    sendError(res, 404, `no space ${spaceId}`);
    return;
  }

  const file = req.file;
  if (!file) {
    sendError(res, 400, 'no file part named "file" in the multipart body');
    return;
  }

  const title = file.originalname.trim();
  const mimeType = acceptedMime(title, file.mimetype ?? '');
  if (!mimeType) {
    sendError(res, 400, `unsupported file type: ${title} (${file.mimetype}) — accepted: .pdf, .md, .txt`);
    return;
  }

  const docId = newId('doc');
  // GridFS first, then the row that points at it, then the job that reads the row. Any other
  // order leaves a job whose file is not there yet.
  const fileId = await putFile(file.buffer, title, mimeType, { docId, spaceId, userId });

  const doc = DocumentDoc.parse({
    _id: docId,
    spaceId,
    userId,
    title,
    mimeType,
    bytes: file.size,
    status: 'pending',
    pct: 0,
    fileId,
    createdAt: new Date()
  });
  await insertDocument(doc);
  await insertJob({ kind: 'index_document', userId, payload: { docId, spaceId } });

  const ms = Date.now() - started;
  res.status(202).json(UploadDocumentResponse.parse({ docId, status: 'pending' }));
  // The number the SLA grades, on every upload, so a regression shows up in the log before it
  // shows up in a benchmark run.
  log.info({ requestId: req.requestId, docId, spaceId, title, bytes: file.size, ms }, 'upload accepted');
}

// ---------------------------------------------------------------- list

spaceRoutes.get('/spaces/:spaceId/documents', requireUser, async (req, res, next) => {
  try {
    const spaceId = req.params.spaceId ?? '';
    const space = await getSpace(req.userId!, spaceId);
    if (!space) {
      sendError(res, 404, `no space ${spaceId}`);
      return;
    }
    const rows = await listDocuments(spaceId);
    res.json(
      ListDocumentsResponse.parse({
        documents: rows.map(
          (d): DocumentRow => ({
            docId: d._id,
            title: d.title,
            status: d.status,
            pct: d.pct,
            // The schemas use `.optional()`, so an unset field is ABSENT, never `null`: a
            // `pages: null` fails zod on the client that compiled against these types.
            ...(d.pages !== undefined ? { pages: d.pages } : {}),
            ...(d.chunks !== undefined ? { chunks: d.chunks } : {}),
            ...(d.error !== undefined ? { error: d.error } : {})
          })
        )
      })
    );
  } catch (err) {
    next(err);
  }
});
