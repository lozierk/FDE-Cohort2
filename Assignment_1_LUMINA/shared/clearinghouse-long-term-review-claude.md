# Long-term review of the board proposal: failure modes, alternatives, human oversight

**Status:** Claude's artifact for the 2026-09-09 discussion with Codex (CODEX-050 to 053,
CLAUDE-046 to 048). Revised after Codex's corrections in CODEX-053 and a delegated survey of
existing tools (section 5), which Claude reviewed and spot-verified (both Agent Mail licenses
fetched directly). Companion: `shared/clearinghouse-long-term-review-codex.md`, whose scenario
matrix and data model are the better spine for the joint recommendation.

Kurt's question, restated: is `board/PROPOSAL_FOR_KURT.md` the right approach for four
assignments plus the demo-day project, or only good enough for this one? Should storage be a
database such as Supabase, so decisions can be referenced across projects? What would a
general-purpose, installable clearinghouse for agents from several model families look like,
and does one already exist?

## 1. Failure modes of the file proposal at cohort scale

Designed for one assignment, two agents, one repo. Ranked by how likely each is to bite.

| # | Failure mode | When | Fix inside the file design |
|---|---|---|---|
| F1 | **Cross-project decisions have no home.** A rule agreed in Assignment 1 is buried in its STATE.md and re-litigated in Assignment 2. | Day one of Assignment 2 | A repo-root `decisions/` ledger with global IDs and a `scope:` field (project or program). Promotion from project to program scope is an explicit act with an approver, never inferred from recency or similarity (Codex's rule, adopted). Each assignment's STATE.md links to the ledger. |
| F2 | **Startup cost grows again**: protocol, ledger, and per-assignment state drift apart. | Assignment 3 | A generated `START_HERE.md` per assignment carrying an as-of marker: protocol pointer, ledger digest, STATE.md, unread count. |
| F3 | **Agent identity is a filename prefix.** Breaks with a third agent or two sessions of one agent. | First extra agent | Header fields `agent:`, `model:`, `session:`; the prefix is a registered logical agent, not a vendor. A registry lists agents. |
| F4 | **No wake-up.** An idle agent cannot be told a message arrived. | Already, daily | Not fixable by storage. Neither Claude Code nor Codex CLI is woken by a file change or a database event without a running process. A realtime feed helps only an already-running client. |
| F5 | **Human view drifts from truth.** | Any week | Every generated view carries an as-of marker and the message count it covers. No hidden hooks. |
| F6 | **Inbox ownership across sessions.** Per-session receipts replay the whole backlog on every restart. | First restart | The inbox belongs to the logical agent; a new session inherits it with an explicit handoff line in STATE.md. Unread and pending work survive session replacement. |
| F7 | **Search across seven weeks.** | Assignment 3 onward | The ledger answers decision questions. Message search stays `grep`, adequate at this volume and usable by every model family. |
| F8 | **Privacy.** The board lives in the code repo. A private repo is not consent to share all coordination with graders, and ignore rules or redaction cannot unpublish committed history. | When the repo is shared for grading or portfolio | The operational mailbox lives outside the code repo (a sibling private repo or a local directory); the code repo holds a project-ID pointer and explicit, redacted exports. This changes the migration plan (section 6). |
| F9 | **Relayed vs verified human input.** An agent reporting "Kurt said" is not the same as Kurt's verified reply. | Any approval | The human is a distinct authenticated principal. A Telegram reply ingested with sender and update-ID checks is recorded as verified; anything an agent relays is recorded as relayed. Approvals bind request ID, action version, and expiry. |

**Conclusion.** Every material failure mode is fixed inside the file design, and one of them
(F8) changes where the files live. None requires a database. Databases do bring real things
files lack: transactions, uniqueness constraints, atomic receipt-plus-outbox commits, indexed
queries. For two agents on one Mac those are conveniences, not needs.

## 2. The database question

**What SQLite would give**: transactions, uniqueness, atomic receipt and outbox, indexed and
full-text queries, one authoritative write path. No account, no network.
**What Postgres or Supabase adds**: remote clients, row-level security per principal, a hosted
dashboard, a realtime feed. Costs: an account and key on every client, a network dependency,
schema migrations, backups to test, and a human view that needs a dashboard or an export.

**When each is right.** SQLite behind one local service when several local clients share one
mailbox and want queries. Postgres when clients are on different machines or always-on human
access matters; Supabase is a hosting choice within that, not the architecture. The cohort's
topology, two agents started by hand on one Mac, does not need either.

**Rule if a database ever exists**: it is the single authoritative write path; Markdown and Git
are regenerable exports; a failed export never undoes a committed message. Adapters between
backends need real migration and consistency tests, not a format swap.

## 3. Human oversight and notification

Today: `notify_kurt.sh` (Telegram plus macOS, one alert per board ID, one reminder) and
`check_kurt_replies.sh`. It works and is one-way, one-project, hardcoded.

Changes for the cohort, in priority order:

1. **Escalation levels.** `ATTN` (decision needed, Telegram now), `REVIEW` (within the day,
   in a digest), `FYI` (no ping). Today everything is an interrupt.
2. **A daily digest** at session close: decisions taken, questions for Kurt, spend to date,
   next steps. One Telegram message or one file with an as-of marker.
3. **Verified replies land as messages** from the human principal with the request ID they
   answer, sender and update-ID checked, deduplicated. Relayed statements stay labelled.
4. **Approval gates as data** in STATE.md: `trial_ceiling_usd: 10`, `approved_by`, evidence
   ID, expiry. Acknowledging a message never approves a payment or a deploy.
5. **Four questions the human view answers fast** (Codex's list, adopted): what needs my
   decision, what is blocked, what changed, who is active.

## 4. What a general-purpose clearinghouse would be

Codex's section 3 (architecture), 4 (data model) and 6 (repository layout) are the reference;
I add only the framing:

- **Protocol, not product.** A message is a small structured record (Markdown with a header,
  or a row) with `id`, `agent`, `model`, `session`, `to`, `re`, `written`, `kind`, `scope`,
  content hash, idempotency key. Anything that can write a record can participate.
- **One service, two client surfaces.** A CLI for any agent with a shell and an MCP server
  exposing the same tools. Section 5 confirms Claude Code, Codex CLI and Gemini CLI are all
  MCP clients today, so MCP is a universal interface for harnesses; models reached through
  OpenRouter (GLM, Kimi) participate only through whichever harness runs them.
- **Human channel as an adapter.** Telegram or Slack outbound for `ATTN` and digests; verified
  inbound replies become messages from the human principal.
- **What it is not.** Not a supervisor, not a scheduler, not a wallet. It never grants tool,
  spend or secret authority, and it never invokes a model on its own.

## 5. Existing systems (delegated survey, reviewed; licenses of the two Agent Mail repos verified directly)

| Project | What it is | License | Fit |
|---|---|---|---|
| MCP Agent Mail, Rust `am` (v0.3.35, released 2026-09-09; the maintained line) | Persistent mailbox: threads, unread, explicit acks, advisory file leases, SQLite + Git Markdown archive, MCP + CLI, TUI and web "Human Overseer"; agents self-register with program and model | MIT **plus a rider** denying all rights to OpenAI, Anthropic, affiliates and anyone acting for their benefit | The only project that meets the whole brief. Blockers: non-standard license that travels with any fork (the maintainer states in issue 252 that ordinary users running Claude Code and Codex are not restricted; that is his reading, not a legal opinion); recurring SQLite corruption reports across four issues in six months (123, 242, 246, 253), each fixed, all closed; polling only, no push or Telegram bridge |
| MCP Agent Mail, Python | Same design, called "legacy" by the maintainer | Same rider | Superseded |
| postal-mcp, AgentRelay, airchat, agentbox | Small MCP mailboxes or boards | Apache-2.0 or MIT, clean | Hobby scale (1 to 5 stars), no receipts or human channel worth the name |
| agent-inbox | SQLite mailbox, ActivityStreams, MCP | GPL-3.0 | Copyleft; 3 stars; default purge of threads idle 14 days conflicts with a decision history (Codex, CODEX-054) |
| MustaphaSteph/agent-bus (Codex's find; README and docs/tools.md read by both agents) | Local SQLite bus, stdio MCP; threaded replies, inbox with `claim` plus explicit `ack`, `mark_delivered:false`, durable `record_decision` and `remember(supersedes_id)`, session briefs, tasks with a Todo→Accepted→Doing→Review→Done state machine and review gates, project and area scoping, CLI send/watch/wait, read-only web cockpit; lists Claude Code, Codex CLI, Kimi Code, Cursor, Gemini CLI and others | MIT, clean (verified) | **The standard-license pilot candidate.** Caveats: no authentication by design; each session's MCP process writes the shared WAL file directly rather than through one service; default inbox marks delivered, so a pilot must use claim plus ack and crash-test it; no Telegram; all features are documentation claims until tested. Earlier draft of this row wrongly said it had no receipts or decision model; corrected after CODEX-057/058 |
| HakAl/agent-comms (Codex's find; license fetched) | Local SQLite mailbox, stdio MCP, 10 tools, CLI | GPL-3.0 | 1 star; README admits per-call `agent_id` is spoofable; dashboard unimplemented |
| awslabs cli-agent-orchestrator | Runtime orchestrator of 12 CLIs including Claude Code and Codex | Apache-2.0 | An orchestrator, not a board; worth knowing for later |
| A2A (Linux Foundation; IBM's ACP merged into it 2025-08) | Runtime RPC between agents | Apache-2.0 | Not storage, not a decision log; an adapter later if a participant needs it |
| Letta, mem0, Zep | Memory layers | Apache-2.0 | Not boards |
| AutoGen / AG2 group chat | In-process chat | Apache-2.0 / MIT | Single runtime, not cross-CLI; AutoGen is in maintenance mode |
| HumanLayer | Human approval routing via Slack and email, MCP | Custom (NOASSERTION) | Closest to the approval-channel piece; 11.5k stars |
| Supabase official MCP server (`supabase/mcp`) | `execute_sql` and migrations over MCP, not read-only by default | Apache-2.0 | Makes a Supabase board reachable from any MCP client; no inbox template exists, we would design the tables and RLS |
| Telegram bridges for Claude Code (claude-code-telegram, claude-telegram-relay) | Chat relays | none declared / MIT | Single-vendor; our own script already does the job |

**Reading (revised after CODEX-057/058).** Two projects provide a persistent, vendor-neutral
board with acknowledgements, durable decisions and a human view. **agent-bus** does it under a
clean MIT license with no authentication and direct multi-process writes to one SQLite file.
**Agent Mail** does it more richly, with a single service, Git archive and file leases, under
MIT plus the rider; the author stated on the record (issue 252, verified through the GitHub
API by both agents) that ordinary Claude Code and Codex customers are not Restricted Parties
and that connecting those clients is the intended path, so personal use is not prohibited; the
non-standard terms still warrant diligence before redistribution or derivative work, and its
corruption history (issues 123, 242, 246, 253, each fixed) argues for tested backups. Neither
has been tested against our contract. So the compromise in CLAUDE-048 resolves to: **agent-bus
qualifies for the capped half-day pilot** on synthetic data. Codex favors running it during the
assignment; Claude prefers after 2026-09-18 so LUMINA's deadline is protected. Kurt decides.

## 6. Recommendation (Claude's side of the joint document)

1. **Approve the file proposal for Assignment 1 now**, with three amendments from this review:
   agent identity in the message header (F3); a `decisions/` ledger with global IDs and
   explicit scope promotion (F1); and the mailbox moved outside the code repo (F8): a sibling
   private repo `FDE-Cohort2-board` or a local directory with its own backup, with the code
   repo holding a pointer and redacted exports only.
2. **No database for the cohort.** Revisit only if a third concurrent agent or a second
   machine appears.
3. **Notification upgrades in Week 2** of Assignment 1: escalation levels, daily digest,
   verified replies as messages, approval gates as data.
4. **The general-purpose clearinghouse is a separate project after 2026-09-18**, built to
   Codex's contract (identities, scope, inboxes, receipts, decisions with provenance and
   supersession, exports) with SQLite behind one local service first, CLI and MCP on one
   implementation, Telegram adapter, and Postgres or Supabase only when topology demands it.
   It is a credible portfolio repository for Kurt. No effort estimate is offered.
5. **agent-bus is the pilot candidate; Agent Mail is the richer reference design.** The pilot
   is optional and isolated: synthetic data, five mock projects, two real clients, claim plus
   ack, restarts, duplicate retries, one restore. It never touches the LUMINA board. Timing is
   Kurt's call between the two agents' preferences above.
