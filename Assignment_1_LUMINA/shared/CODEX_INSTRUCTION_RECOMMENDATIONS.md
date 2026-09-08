# Codex instruction recommendations

Audience: Kurt and the next Codex session. Based on the global Codex instructions supplied in this conversation and Claude's shared source package, read on 2026-09-08. No global Codex file was inspected or changed.

Your current Codex instructions already cover most coding, communication, audience, safety and continuity preferences. The useful additions are specific conventions, not a wholesale copy of CLAUDE.md.

| Addition | Treatment |
|---|---|
| Resume/SetPoint naming, measured ET timestamp, latest-file authority | Captured in project AGENTS.md and the handoff; propose merging into global continuity guidance later. |
| Resume after reading and confirming state, with a clear next-step gate | Preserve for explicit resume requests; respect a current instruction that already says to proceed. |
| Always show context usage; identify used vs remaining; no invented telemetry | Captured locally with documented CLI configuration. |
| Short global instructions with conditional pointers to detailed workflows | Use the shared writing-for-agents principles; keep assignment-specific details in project files. |
| Cross-project brain hub | Potentially useful, but do not automatically copy its unrestricted read/write behavior into Codex. Define scope and authorization separately. |
| Claude model delegation ladder | Keep Claude-specific. Do not add it to Codex or change the user's selected Codex model as a side effect. |

Global configuration normally uses `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`). An `AGENTS.override.md` can take precedence; project files add more specific guidance. Review the actual active files before merging a future global draft. Claude's `@file` imports should not be assumed to work as Codex instructions. [Official AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Skills worth carrying forward

- **close:** richer restart prompts, paused-versus-finished distinction, explicit remaining decisions. Portable artifact rules are usable now; Claude memory and external hub operations need adaptation.
- **writing-for-agents:** concise instructions, strong conditional pointers, checkable completion criteria. Read and applied to the local instruction structure in this session.
- **spec-wargaming:** already shared for the assignment. Codex read its main file; referenced stages still need reading when used. Reciprocal Claude/Codex review follows Kurt's explicit assignment request.
- **rigor-mode:** candidate for difficult debugging and higher-stakes verification; copied but not evaluated in depth yet.
- **grilling / to-questionnaire:** candidates for consequential unclear decisions; avoid making them automatic for routine work. Copied but not evaluated in depth yet.

The audience-aware writing command largely duplicates existing Codex preferences. The prototype command may be useful for visual exploration, but this assignment's supplied UI limits where it applies. The new-project command has Claude-specific hooks; do not install it unchanged.

Source map: `kurt_config/README.md`, `kurt_config/CLAUDE.shared.md`, and `kurt_skills/README.md`. Claude reports the shared copies match its originals; Codex reviewed the project copies, not unrelated source folders. No skills were installed globally.

## Staged brain-hub summary

For a later authorized update to Kurt's cross-project hub: On 2026-09-08, LUMINA coordination was established between Claude and Codex with a canonical message board, separate build ownership and a tested Telegram bot/reply path. The rotated token is stored only in private local config. Kurt's Resume_from/SetPoint conventions and always-visible measured context preference were shared and captured in local Codex instructions. Application design/build remains next; service/model/budget decisions are open. Project: Assignment_1_LUMINA; handoff: Codex_Build/Resume_from_20260908_1257.md; completed coordination snapshot: shared/SetPoint_20260908_1257.md.

This summary is staged locally. The shared close skill calls for a `~/brain` update and commit/push, but this task did not authorize writes to that unrelated repository; no hub files, global instructions or remote repositories were changed.
