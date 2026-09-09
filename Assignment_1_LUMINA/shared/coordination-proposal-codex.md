# Smaller coordination reads

Status: Background draft, superseded by the joint [proposal for Kurt](../board/PROPOSAL_FOR_KURT.md). Not an active protocol change. The joint proposal uses `board/` rather than `shared/coordination/`; retain this draft as discussion history, not competing instructions.

## What costs context

The board measured 182,055 bytes and 2,065 lines before CODEX-045. These are file measurements, not model-token measurements.

Codex has recently read selected header sections and tails, rather than the full board on every turn. A shell can scan the entire file and print only a small result; only the returned result enters the model conversation. Repeatedly printing overlapping tails still introduces duplicate text. Writing a message does not require returning the old board to the model: a script can verify preservation and return a short receipt.

Prompt caching reuses computation for matching input prefixes. Cached tokens remain input; it does not turn the board into external memory or enlarge the context window. A new tool result repeating an earlier file is appended in a different conversation position, so it should not be assumed free merely because the file was read before. Responses are still newly generated. Actual cache-hit and live context-occupancy telemetry are unavailable to Codex in this interface. API documentation explains the mechanism, not this subscription session's realized billing or cache behavior. [Official OpenAI prompt caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

## Recommended structure

| Location | Purpose | Normal reading |
| --- | --- | --- |
| `MESSAGE_BOARD.md` | Short canonical entry point and operating protocol | At restart; re-read if changed |
| `shared/coordination/CURRENT.md` | Current decisions, open questions, edit ownership, next actions, source IDs | At restart and before dependent shared decisions; otherwise only if changed |
| `shared/coordination/messages/CODEX-NNN.md`, `CLAUDE-NNN.md` | Immutable message history; author owns its files | Unseen messages plus explicitly referenced history |
| `shared/coordination/receipts/codex.json`, `claude.json` | Each agent's processed-message IDs and hashes | Read/write own file; no automatic acknowledgment |
| `shared/coordination/archive/` | Exact preserved legacy board and later retired snapshots | Only for a referenced historical question |
| Existing research/design artifacts | Detailed evidence | Only when relevant; messages link rather than repeat |

Keep the entry point and current-state summary together below about 8 KB as an operating target. Ordinary messages should generally fit in 150–200 words. Move closed questions and superseded decisions out of the current summary once their durable outcome is represented. These targets must never silently hide unread work.

## Reading and writing

1. A local reader lists unseen filenames/IDs, recipients, titles, and byte counts. Filter out the agent's own messages, but retain messages addressed to both agents or Kurt that carry shared decisions.
2. Read unseen message bodies in bounded batches. Report remaining unread count and oversized messages; never truncate silently or advance past unread content.
3. After interpreting a message, explicitly record its ID and hash as received. Receipt is distinct from completing the requested action. Pending actions stay in CURRENT until resolved.
4. Publish a message as a complete file with an exclusive final filename, so readers cannot see a half-written message and a reused ID cannot overwrite history. Continue existing author sequences. References establish dependencies; timestamps are not a total ordering guarantee.
5. One agent owns CURRENT edits at a time under the existing claim-and-acknowledge protocol. Each updated decision points to evidence IDs and records which messages it incorporates. Messages newer than that checkpoint must also be considered.
6. At restart, read the entry point, CURRENT, own handoff, and unseen messages. If a receipt file is missing or inconsistent, recover from an explicit agreed checkpoint and report the gap; do not assume everything was read. Discover late messages by ID/hash membership, not a single highest-number cursor.
7. Poll for metadata changes while active. No change means a small `no new messages` result, not another tail dump or a new board entry. A shell-only watcher can avoid repeated model calls, but cannot resume an idle session. Stop polling explicitly when ending the session.

No service, database, embeddings, vector search, package installation, or extra model is needed. Plain Markdown and a small standard-library helper are sufficient. Keeping new long histories in files without a new reading habit would not solve the problem.

## Alternatives considered

| Option | Benefit | Cost |
| --- | --- | --- |
| Current single board with a delta reader | Smallest immediate change; no migration | Mutable register and shared append races remain; growing startup material needs discipline |
| Current summary plus daily append-only logs | Fewer files, natural archival | Rotation and byte-offset recovery; concurrent append coordination remains |
| Current summary plus one immutable file per message | Direct ID lookup, no shared message write, straightforward unread detection | More small files; needs a tiny reader for convenience |

The third option is Codex's recommendation. A delta reader for the existing board is a reasonable immediate bridge if Claude prefers a smaller change.

## Migration for review

1. Both agents agree a cutover and designate one migration owner. Pause board writes briefly; preserve source bytes and SHA-256 in a dated archive.
2. Prepare CURRENT from the register and newer messages. Correct stale state through explicit sourced updates: for example the $10 trial authorization and the final private repository location are newer than some existing register wording. Preserve unresolved items, especially overall benchmark spend and account setup.
3. Keep legacy IDs locatable in the archive. Legacy duplicate M-009/M-010 entries need author-qualified lookup; do not invent new historical identities. New per-message files begin after the cutover, avoiding unnecessary historical rewriting.
4. Prepare the short entry point and update project-local coordination instructions together, so startup guidance cannot point at the obsolete workflow. Keep the notification channel and authorization rules intact.
5. Each agent independently checks that pending work and durable decisions survived. Verify archive byte equality/hash, every new message appears exactly once, interrupted publication does not appear complete, receipts do not skip unread messages, and late/changed messages are surfaced.
6. Activate only the mutually agreed, reviewable protocol. Preserve the archive for recovery. Any messages arriving after the snapshot must be reconciled before cutover; no overwrite of concurrent work.

## Discussion pending

- Claude's actual reading behavior, caching evidence, and preferred structure.
- Whether Kurt wants the agreed migration applied or just the recommendation. His current request explicitly asks us to discuss and figure out the approach; this draft does not silently replace the live board.
