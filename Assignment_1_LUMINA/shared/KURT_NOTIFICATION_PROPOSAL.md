# Proposed LUMINA alerts for Kurt

Status: Accepted and Telegram operational on 2026-09-08. Bot: @Kurts_Alert_Bot. Both Claude and Codex sent Telegram tests; Kurt confirmed receipt, and validated reply ingestion succeeded. Both desktop commands succeeded, but Kurt has not separately confirmed desktop visibility/sound. See CLAUDE-016 onward and CODEX-018 / CODEX-019 in MESSAGE_BOARD.md. Polling requires an active agent session.

## Recommendation

Use **a shared Telegram bot for phone alerts and replies, plus a Mac desktop notification with sound** for urgent decisions. Both agents use the same project-local helpers. Routine questions remain on `MESSAGE_BOARD.md`.

This avoids depending on one agent's private connector. Phone delivery and reply ingestion are conditional on an end-to-end test after acceptance; neither is yet verified. If Kurt declines Telegram, iMessage send-only is an optional alternative requiring separate setup and testing.

## What Kurt receives

Example only:

> ATTN: KURT — LUMINA — CODEX-021 — BLOCKED
> Both agents recommend option A for hosting. Need your decision by 3 PM ET to continue deployment. Reply here with “CODEX-021: approve A,” or reply in either agent conversation or on MESSAGE_BOARD.md. Full options and consequences are on the board.

Alerts include the decision, recommendation, urgency/deadline, and board message ID. They exclude credentials, private documents, and sensitive content. A local file path is a reference, not a remotely accessible phone link, so the message itself includes enough context to understand the request.

## Sending and acknowledgment

1. Discuss the decision on the board and record both agents' agreement that Kurt is needed. Assign one sender.
2. The sender uses the shared helper for both desktop and Telegram, logs each channel's submission outcome, and prevents duplicate sends for that ID.
3. Kurt replies in Telegram, either active agent conversation, or directly on the board. During active coordination, agents check for Telegram replies about every 30 seconds and before dependent actions. Only the configured private chat and Kurt's verified sender ID are accepted. One shared lock prevents competing reply readers; replies are saved locally before advancing the retrieval cursor. The receiving agent records his decision on the board, distinguishes “received” from “acted on,” and acknowledges receipt in Telegram when that is the source. An acknowledgment without a decision does not authorize proceeding.
4. If Kurt has not acknowledged after 15 minutes, the active sender may send one reminder. No repeated reminders and no assumed consent. Continue any independent work.
5. If sending fails, record the failure and surface it in the active agent conversation. Desktop notification alone is not a reliable substitute when Kurt is away.

Either active agent may send a question already jointly approved for escalation. An unavailable peer is not treated as agreement on a new question. A broader solo-escalation exception is not part of this proposal.

## Setup and acceptance test

- Kurt accepts Telegram plus desktop, the reminder rule, and replies/acknowledgments to his private bot chat.
- Kurt creates a bot through Telegram's `@BotFather` and starts a private conversation with it. Setup records three values: bot token, private chat ID, and Kurt's sender user ID. They go into `shared/notify.config`, excluded from Git, never onto the board. We validate the intended private chat and sender identity during setup.
- Enable the required Mac and phone notification permissions. Any Codex sandbox/network approval is separate from macOS permission.
- Each agent sends one clearly labeled test after acceptance. Kurt confirms that he sees/hears the Mac notification and receives the phone message, including when away from the Mac.
- Kurt replies in Telegram; one agent imports it, acknowledges it, records it on the board, and the other reads it. Verify an unrelated sender is ignored, replayed updates are not duplicated, and two agents do not consume the same reply independently.
- Verify duplicate suppression and failure reporting locally. Activate only the channels whose tests pass.

Prepared files: `shared/notify_kurt.sh` sends alerts; `shared/check_kurt_replies.sh` and `shared/tg_ingest.py` collect replies; `shared/notify.config.example` documents configuration. Audit files are `shared/alerts.log` and `shared/kurt_replies.log`. Claude reports offline helper checks passed; Codex reviewed the drafts and identified fixes. Telegram has not been tested against the service, and Codex's desktop execution is still untested.

## Practical limits

The Mac must be awake and online for the helpers to send or collect replies. Focus/notification settings can silence alerts; Kurt should allow the relevant notifications during work sessions. [Apple's Focus settings guidance](https://support.apple.com/en-gb/guide/mac-help/mchl613dc43f/mac).

A successful command means the notification was submitted, not that Kurt saw it. A phone alert does not wake an idle agent session. Reminders occur only while an agent is active; no background daemon or recurring service is proposed here.

Telegram supports sending and reply retrieval through its HTTP API. Undelivered bot updates are retained for no more than 24 hours; after a longer offline period, reconcile directly with Kurt instead of assuming all replies were collected. Alerts and replies pass through Telegram, so keep them to minimal project decisions and never include secrets or sensitive documents. [Telegram Bot API](https://core.telegram.org/bots/api).
