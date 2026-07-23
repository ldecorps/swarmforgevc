# BL-349 stuck-escalation-email-headless — 20260713 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `9b990c73af` into the architect worktree and reviewed the
combined parcel. No TypeScript/extension files are touched by this ticket
(pure Babashka + Gherkin step wiring), so `dependency-gate.js` (which
enforces the `extension/.dependency-cruiser.cjs` ruleset scoped to
`extension/src`/`extension/test`) does not apply to this parcel — noted
rather than silently skipped.

## Logical coupling: co-change-report.js

Ran against the parcel's changed files
(`handoffd.bb`, `stuck_escalation_email_lib.bb`, `dispatchGapSteps.js`,
`stuckEscalationEmailSteps.js`). All SUSPECTED COUPLING reported against
`handoffd.bb` is its already-known large fan-in (it hosts every
`*-sweep!` adapter in the daemon); this ticket's own new file
(`stuck_escalation_email_lib.bb`) co-changes only with its own tests and
`handoffd.bb` at frequency 1, as expected for a same-commit ticket. No new
unexpected coupling.

## Boundary / correctness checks

- Reuses the ONE shared email sender: `send-escalation-alarm-email!`
  (`handoffd.bb`) calls `daemon-alarm-lib/send-configured-email!` — the
  same Resend client the daemon-death alarm and briefing email already
  use. No second sender was built.
- `stuck_escalation_email_lib.bb`'s `sweep!` was read line-by-line against
  the BL-333/BL-345 rule this ticket exists to not repeat: every path that
  reaches `write-state!` has already computed `outcome` via
  `classify-delivery-result` from a real `result` in hand — there is no
  code path that persists `:armed? true` before or without consulting the
  send result. `:delivered`/`:terminal-misconfig` arm immediately;
  `:transient-failure` never arms and instead increments a bounded
  attempt counter with exponential backoff (`compute-backoff-ms`,
  capped), arming only once `max-attempts` is exhausted and logging a
  loud give-up (`:gave-up? true`) at that point — matching the rule's
  transient/terminal/exhausted three-way split exactly.
- Edge-triggering is correct: recovery (`escalated?` false) `dissoc`s the
  whole per-role state entry, so a later re-escalation starts fully fresh
  and re-emails — verified by reading `sweep!` directly, not just the
  evidence narrative.
- The new sweep call in `handoffd.bb`'s `:on-stuck-escalation!` is wrapped
  in its own `try`/`catch` (`stuck-escalation-email-sweep!`), so a failure
  here can never take down `chase-sweep!`'s other work; `write-escalation!`
  itself is untouched and still called unconditionally alongside it, so
  the existing file record is preserved.
- Scope-overlap sequencing respected: BL-350 (which also edits
  `handoffd.bb`'s poll loop per the ticket's own note) is still in
  `backlog/paused/`, not active — confirmed no concurrent in-flight
  conflict.
- The `dispatchGapSteps.js` step-text collision fix (`/^the sweep runs$/`
  shared with BL-349's own scenario 07) follows the project's established
  branch-on-context-flag pattern (matches
  `mergedCodeReachesDaemonsSteps.js`'s prior identical case) rather than
  shadowing or duplicating the registration — existing scenarios in that
  file are unaffected when the flag is absent.

No violations found. Forwarded to hardener with the same task name.
