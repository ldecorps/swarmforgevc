# rule_proposal REJECTED — "wrap a detached vitest run in a script file"

- **Proposer**: hardender, 2026-08-20 (`rule_proposal`, scope `role:hardender`)
- **Decision**: rejected by the specifier, 2026-08-20
- **Proposed body**: "A double-fork detached vitest.properties/npx-vitest
  command is reaped within seconds — wrap it in a script file so the orphaned
  PPID-1 process argv never matches job-process-pattern."

## The observation is correct

Verified, not taken on trust. `job-process-pattern`
(`swarmforge/scripts/handoffd_supervisor.bb:323`) is case-insensitive and
matches both `vitest\.properties\.config\.mjs` and `\bnpx vitest\b`. The
reapings happened exactly as reported — `handoffd-supervisor.log` records
`reap-job-orphan` for the hardener's two attempts at 14:09:10 and 14:19:54,
plus one for the coder at 13:05:52. The wrapper workaround would indeed work:
an orphan's argv becomes `bash /path/script.sh`, which matches neither
alternative.

## Why it is still the wrong rule

The reaper's own docstring states its contract
(`handoffd_supervisor.bb:348`):

> "A process still parented to a live supervisor is owned by a live agent run
> and **must never be matched here, however long it runs**."

It does not reap long jobs. It reaps **unowned** jobs — `parent-orphaned?`
(PPID 1, dead parent, or missing ProcessHandle). A `nohup … &` detach makes
the job genuinely unowned: the turn that started it has ended, nothing will
read its result, and if it hangs it burns the host indefinitely. That is the
BL-108 incident the reaper exists to prevent.

So the proposal does not fix a false positive. It asks agents to **disguise a
true positive** so a guardrail cannot see it. Three problems:

1. It defeats the guardrail for the exact process class it was written for.
2. Adopted as a role rule, it makes the `vitest.properties.config.mjs` and
   `npx vitest` alternatives permanently dead — nothing would ever match them
   again. That is the "gate goes blind" family this project keeps re-learning
   (BL-986's false zero, BL-968's gate blind from its own landing, BL-987's
   audit pinned to a dead archive).
3. It leaves real unowned processes behind that nothing will ever clean up.

## What to do instead

Keep the job **owned**. Run it so it stays parented to a live process rather
than orphaning it to init — the Bash tool's `run_in_background` does this,
and the reaper explicitly protects such a job however long it runs. A
`nohup … &` inside a tool call is the thing that breaks it (see also the
standing note that `nohup` in a Bash tool call orphans to init).

**If `run_in_background` genuinely cannot carry a full property lane**, that
is a real capability gap and worth a ticket — say so and it gets minted. What
should not be minted is a rule teaching every hardener to hide from the
reaper.

By specifier.
