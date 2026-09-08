---
name: rigor-mode
description: A four-gate working discipline (scope, evidence, adversarial reasoning, verification) for multi-step builds, debugging, and review where the first answer might be wrong.
disable-model-invocation: true
---

# Rigor Mode

Explicitly-invoked discipline for tasks where the first idea might be wrong: multi-step builds, debugging, research with claims, anything touching data you haven't looked at yet. Skip it for one-file edits and simple lookups — forcing four gates onto two-minute work is its own failure mode.

This is method, not workflow: it changes how you execute the current task and produces no files of its own. When a task stalls or a result surprises you, name the gate you're on and re-run it.

## The four gates (in order — each must pass before the next opens)

**1. Scope.** Define done in one or two sentences: what artifact exists at the end and how you'll check it's correct. If you can't write the check, you don't understand the task yet. Name the one to three load-bearing unknowns — facts that, if wrong, change the whole solution. Ask a question only if the ambiguity would change what you build; otherwise state your default in one line and proceed.

**2. Evidence.** Open the real file, API response, or dataset before designing against it — memory is a hypothesis generator, not a source. Probe the biggest unknown with the cheapest test first. Push one item end-to-end through the pipeline and verify it before scaling to all of them. Keep a live plan for anything 3+ steps, sliced by dependency, not category.

**3. Adversarial reasoning.** Before committing, attack your own answer as a hostile reviewer: what input or reading makes it wrong? Actually test that case — don't just imagine it. Steelman what survives, and steelman the existing thing before changing it: assume a reason exists and name it. Re-decide after every result — does it confirm the plan or invalidate it? Two failed attempts at the same fix means the diagnosis is wrong: stop patching, find the shared assumption, test it directly. When reviewing, finding nothing wrong is a legitimate result; never manufacture findings.

**4. Verification.** "It ran" is not verification. Verify at the layer of the claim: if the claim is "the output is correct," look at the output — exit code 0 only proves the layer below. Use evidence you didn't generate: re-open the file, read the screenshot, diff before against after, count what you claimed to count. Sample the tails — first, last, weirdest — not just the middle. Treat a too-clean result as suspect until you can explain why it's real.

## Gate-skip smells — any one means stop and go back to that gate

- Building on data / a file / an API response you haven't opened. → Gate 2
- You just thought "should work" about something you can test right now. → Gate 4
- You're on attempt three of the same fix. → Gate 3
- Your last three actions came from the original plan with no check against intermediate results. → Gate 3
- You're about to report done and the evidence is your intention, not an observation. → Gate 4
- A result came back surprisingly clean and you moved on without asking why. → Gate 4
- You can't say in one sentence what done looks like. → Gate 1

## Notes

- Stacks with task-specific skills (/verify, /code-review): those are how to check, this is the discipline of when to reach for them.
- If a task keeps failing under this discipline, that's the signal to escalate to a stronger model — not to loosen the process.
