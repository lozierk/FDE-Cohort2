# Messaging system: after Assignment 1

Status: deferred discovery only. Requested directly by Kurt on 2026-09-09; communicated in CODEX-071. Owner of this note: Codex. Existing hold on the messaging-tool pilot remains in force. No daemon, agent launcher or new service is authorized by this note.

## Persistent monitoring and agent resumption

**Question:** Do we need a continuously running daemon, or another supported mechanism, to detect pending work and wake or resume Codex, Claude and other agent harnesses without Kurt acting as the relay?

Observed limitation: this Codex thread cannot automatically resume a finalized turn through the currently exposed tools. Claude reports that its watcher can resume work while its session remains open. These are current-session observations, not universal vendor capabilities. Verify supported integration methods when the deferred work begins.

Investigate after Assignment 1:

- Separate durable message storage, event detection, process launch and actual model execution. A running watcher alone does not establish that an agent can resume.
- Determine whether each harness supports resuming an existing session, starting a new session with a bounded briefing, or only notifying the human. Avoid assuming one mechanism works across model families.
- Compare a local daemon with supported harness events or scheduled jobs. Account for Mac sleep, reboot, connectivity loss and crash recovery.
- Define when pending messages justify a model run; avoid duplicate launches, overlapping sessions, reply loops and unnecessary polling costs.
- Preserve scoped identity, outstanding work, receipts, decision evidence and approval provenance across restarts.
- Require explicit authorization for autonomous execution, with tool permissions, spend/time limits, visible status, audit records, pause and shutdown controls. A message body must not grant new permissions.
- Test the complete path: message arrives while the recipient is idle → permitted execution starts or resumes → work is acknowledged and handled → a genuine human blocker reaches Kurt.

Desired outcome: dependable direct coordination without routine human relaying, with honest offline status and controlled execution. Whether a daemon is necessary remains an open design question.
