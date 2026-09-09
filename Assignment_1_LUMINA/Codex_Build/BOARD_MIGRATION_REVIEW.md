# File-board migration acceptance review

Authorization: Kurt's direct approval, recorded in legacy CODEX-063. Claude owns migration; Codex independently reviews before the migration commit. Status: approved after independent re-review of CLAUDE-057; the CODEX-065 corrections are resolved.

## Final re-review

- Independently reran `bash board/tests/fixtures.sh`: all 31 checks passed.
- Repeated the original malformed-receipt case with an empty inbox: the reader now explicitly warns `RECEIPTS INCONSISTENT`. Acknowledgment refuses malformed receipt files until repair.
- Inspected renderer changes: manifest-derived legacy count, clickable archive/manifest links, existing-message reply links and marked legacy references.
- Inspected publisher changes: over-200-word bodies refused by default; explicit `ALLOW_LONG=1` exceptions are visibly labeled. Acceptable for this trusted local workflow.
- Archive SHA-256 remains unchanged from the initial review.
- No blocking findings remain. Claude may commit the reviewed migration within the approved scope. STATE should remove stale starter-copy next actions and record Q-14 closed; these are summary cleanup, not a reason for another review cycle.

## Review results

- Independently ran `bash board/tests/fixtures.sh`: all 23 supplied checks passed.
- Archive: 227,875 bytes, 107 message headers, SHA-256 `8414b7a85f267e2dcfedd66423ac67cb03edebf2e8c674376a51129d440a8a28`, matching manifest. The original pre-cutover file is no longer separately available; byte equality to that original is Claude's reported `cmp` evidence, not an independently repeated check.
- Entry point plus STATE: 7,981 bytes. Pending spend, account, design/review, starter and eval gates retained. CLAUDE-054 read from archive; CLAUDE-055 read and explicitly receipted.
- Updated root AGENTS coordination paragraph under Claude's explicit handoff in CLAUDE-055.
- Required correction: malformed receipt records are not reported. An isolated fixture containing `CORRUPTED RECEIPT` returns success and `no new messages`; the accepted recovery rule requires an inconsistency warning. Existing fixtures do not test this.
- Required rendering corrections: hardcoded legacy count is 105 instead of 107; archive/manifest paths and reply references are not clickable links as proposed.
- Minor: publisher does not enforce the documented 200-word body budget. Clarify it as a target or enforce it; keep future lengthy evidence in separate artifacts.
- The 8-character receipt hash prefix is a convenient accidental-change check, not an adversarial integrity or authentication guarantee. This remains a trusted local file workflow.

Claude retains helper and STATE ownership. The earlier findings above are retained as review history and resolved by the final re-review. The checklist below records acceptance criteria, not additional claimed test results.

## Preservation and cutover

- Pause acknowledged by both agents before replacing the legacy entry point. Snapshot includes every pre-cutover append; compare original bytes and SHA-256 with archive and manifest immediately before replacement.
- Preserve duplicate early M-009/M-010 IDs with author-qualified lookup; do not split or relabel legacy history.
- Record each author's highest allocated ID and actual read checkpoint separately. An allocated ID is not proof of receipt.
- New message allocation starts above the manifest baseline, including an empty messages directory. Archive hash and location are recorded in STATE.
- Keep post-cutover messages during rollback; never overwrite the archive.

## Reader and publisher fixtures

- Listing and printing do not create directories, receipts or other files; missing/inconsistent receipt state is reported.
- Unread detection uses ID plus content hash. Gaps, late arrivals and changed content resurface. Receipts mean read, never action or permission.
- Count and byte bounds apply; oversized messages and remaining unread work are explicitly reported. Nothing is silently truncated or acknowledged.
- Receipt records bind to the exact hash read, so a changed file between print and acknowledgment cannot be silently acknowledged as seen.
- Validate agent and message IDs before path access. Reject path traversal and posting under another author's identity. Local conventions are not an authentication boundary.
- Publish a complete temporary file outside messages on the same filesystem using an exclusive hard link. Duplicate IDs never overwrite. Interrupted publication never exposes partial final content.
- Concurrent publishers produce distinct complete messages. Human rendering preserves every new message exactly once and uses timestamp plus ID ordering, with archive/reference links.

## Scope, identities and current state

- Stable project/cohort IDs and participant identities are separate from model names and session IDs. Store only this assignment's registry/index here; no unapproved parent/hub writes.
- Decisions cite evidence, scope, approving actor, status and supersession where applicable. Referencing another project's decision does not adopt its permissions.
- Entry point plus STATE target under 8 KB; startup reads bounded state and unread messages. Older handoffs must lead to the current entry point.
- Preserve the actual private FDE-Cohort2 repository location, build ownership, September 18 deadline, protected starter contract and reciprocal design review gate.
- Preserve the approved $10 trial limit as distinct from the unresolved full-project budget; runtime model/endpoint recommendation remains subject to validation.
- Preserve account/key setup, deployment/submission decision deferred to UX, eval-flow confirmation, tripwire baseline and re-scan requirement.
- Record amended file migration approved; database/tool pilot not approved. Preserve open factual report corrections until Claude resolves them.
- Keep notification rules, verified-sender checks and explicit ownership handoffs. No implicit agent wake or takeover by silence.

## Evidence to attach after implementation

Archive comparison/hash, fixture command and result, pending-item/source comparison, entry-point and STATE byte count, actual receipt checkpoint, and review disposition. Review findings must be resolved or explicitly reported before the migration commit.
