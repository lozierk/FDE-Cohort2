# Proposal: a smaller, race-free message board

**Status:** joint recommendation from Claude and Codex, 2026-09-08 evening. Nothing is migrated.
Kurt decides. Sources: CLAUDE-044, CODEX-045, CODEX-046, `shared/coordination-proposal-codex.md`.

## Your three questions, answered

**Do we read the whole file every turn?** No, but the two agents differ. Claude lists the
message headers with `grep` and prints only the line ranges it has not seen, so its per-turn
cost is the size of the new messages. Codex reads selected sections and tails, which overlap
from turn to turn, so it re-prints some text. Neither reads the whole 182 KB file. The one
larger fixed cost is a fresh session, which today must read the 91-line header block plus the
last few messages.

**Is a read a cache read?** Not in the sense that matters. Prompt caching reuses computation on
the unchanged prefix of the conversation, which lowers cost and latency. Cached tokens are still
input tokens, and caching does not remove anything from the context window. A tool result stays
in the session's context until the harness compacts or truncates it, so printing the same text
twice occupies the window twice. Neither agent has live cache-hit telemetry in this interface.
Your `ctx` footer measures context occupancy, not cache hits, and it is the only measurement we
trust. Mechanism reference: OpenAI's prompt caching guide,
https://developers.openai.com/api/docs/guides/prompt-caching.

**What actually grows the cost?** Four things:

1. Long messages. Several of today's run past 60 lines. Codex's cap of 200 words is right.
2. Receipt boilerplate. The `Received` and `Acted on` lines are about 10% of the file's bytes
   (`grep -E '^- (Received|Acted on):' MESSAGE_BOARD.md | wc -c` gives 17,883).
3. The header block every new session must read, which grows with every decision.
4. Any whole-file read, by an agent or a helper, now about 182 KB.

Measured with `wc`: 182,055 bytes, 2,065 lines before this discussion. Message count at any
moment is `grep -c '^### ' MESSAGE_BOARD.md`. Bytes and lines are measured; any token figure is
an estimate and we do not quote one as fact.

## Recommended structure

One folder, `board/`, at the assignment root. Plain Markdown and one small shell helper. No
database, no service.

| Path | What it is | Who reads it |
|---|---|---|
| `MESSAGE_BOARD.md` | Short entry point: how the board works, where things are | Every session start |
| `board/STATE.md` | Decisions register, open items, "where we are", next actions, each line citing message IDs. Target under 8 KB with the entry point | Every session start, and before a shared decision |
| `board/messages/<AUTHOR>-<NNN>.md` | One immutable file per message. Written complete as a temp file outside the folder, then published by an exclusive same-filesystem hard link, so a reader never sees a half-written file and a reused ID cannot replace history | Only unread ones, plus any explicitly referenced |
| `board/receipts/<agent>.txt` | The set of message IDs and hashes that agent has read. Read means read, not done | Own file only |
| `board/archive/MESSAGE_BOARD_2026-09-08.md` | Today's file, byte for byte, with its SHA-256 recorded in STATE.md | Only for a historical question |
| `board/BOARD_VIEW.md` | Generated on request: a link to the archive, then every post-cutover message in measured-timestamp order, one file for you to read on GitHub. The legacy history is not re-copied into it | You |
| `board/read.sh` | Helper: list unread, print a bounded batch, record a receipt. Never truncates silently, never records a receipt on its own | Both agents |

Sequences continue from whatever IDs follow the actual cutover. Old IDs stay searchable in the
archive. We do not split the old file into per-message files; the early
`M-009` and `M-010` duplicates make that a risk with no payoff.

## Rules that change

- **Message budget.** 200 words. Longer material goes in a file under `shared/` or a build folder
  with a five-line pointer message. Findings, drafts, scan reports: file first, pointer second.
- **Receipts replace `Received` and `Acted on`.** A message opens with `Ack: <IDs>`. The receipt
  file records what was read. Pending actions live in STATE.md, not in receipt lines.
- **Publish atomically, never replace.** Write the complete message to a temp file outside
  `messages/`, then publish it with an exclusive same-filesystem hard link to the final name.
  If the name exists, take the next number. Readers ignore temp files. Messages and the archive
  are immutable; `STATE.md`, the receipt files and the generated view are the only mutable
  files, each edited by its owner.
- **One STATE.md editor at a time**, claimed and acknowledged on the board as today. Each
  register line cites the messages it incorporates.
- **Read discipline.** Session start reads the entry point, STATE.md, own handoff, and unread
  messages. Polling while active returns "no new messages" or the new IDs, never a tail dump.
  A missing or inconsistent receipt file is reported, not assumed complete.
- **Render for humans.** `board/render.sh` rebuilds `BOARD_VIEW.md` in measured-timestamp
  order with ID as tiebreak, keeping reply-to links. Committed on request.

## Why this design over the alternatives

| Option | Benefit | Cost |
|---|---|---|
| Keep one file, add a delta reader | No migration | The append race that lost CLAUDE-031 today stays; startup block keeps growing |
| Summary file plus daily append-only logs | Fewer files | Rotation, byte-offset recovery, and concurrent appends still need care |
| **Summary file plus one immutable file per message** | No shared write, direct ID lookup, unread detection is a set difference | More small files; needs the small helper |

Both agents recommend the third.

## Migration, if you approve

1. Pause board writes. Copy `MESSAGE_BOARD.md` to `board/archive/MESSAGE_BOARD_2026-09-08.md`,
   record its SHA-256.
2. Write `board/STATE.md` from today's registers, corrected from newer messages (the $10 trial
   ceiling, the repo location, the OpenRouter route are newer than some register wording).
3. Rewrite `MESSAGE_BOARD.md` as the short entry point. Update `AGENTS.md` so startup guidance
   points at the new layout.
4. Install `board/read.sh` and `board/render.sh` only after they pass fixture tests that Codex
   reviews. The current `board/read.sh.preview` is an unapproved prototype; Codex's review
   (CODEX-048) lists what it must still do: compare stored hashes so a changed message
   resurfaces, take its sequence baseline from the cutover manifest, publish by temp file plus
   exclusive link, validate IDs before touching paths, bound output by bytes as well as count,
   and never create receipt files or directories as a side effect of reading.
5. Each agent verifies independently: archive hash matches, pending items survived into
   STATE.md, receipt files are empty and STATE.md names the cutover checkpoint (the last legacy
   ID each agent had read), so nothing pending is presumed read.
6. Commit as one change. Messages after the cutover are new files only.

**Rollback:** the archive is the old board; new per-message files are kept and appended to it
in timestamp order, so nothing after the cutover is lost either.

**Migration owner:** Claude, as today's register editor. Codex reviews before the commit.

## What we ask you to decide

One question: approve this proposal and its migration, or say what to change. Default if you
approve: Claude migrates tonight with Codex reviewing before the commit, and `BOARD_VIEW.md` is
generated on request rather than on every session close.
