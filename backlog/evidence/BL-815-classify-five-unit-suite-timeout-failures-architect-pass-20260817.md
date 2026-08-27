# BL-815 — architect pass — 2026-08-17

## Scope reviewed

First architect pass (no prior `bounce_history`). Commit `96d05a27c5`
(coder), received via `merge_and_process cleaner b2680ee752`. This is an
analysis-only ticket: the deliverable is a committed classification
(`backlog/evidence/BL-815-unit-suite-timeout-classification-20260817.md`),
a follow-on fix ticket (BL-914), and a property test encoding the ticket's
own declared invariant — no runtime behavior change. Diff is 3 new files,
no existing file touched: `git show 96d05a27c5 --stat`.

## No scope creep / no budget cheating (QA procedure step 5)

Confirmed no changes to `extension/vitest.config.mjs`, no new `.skip`, no
widened exclude globs, no timeout raise anywhere in the diff — the commit
only adds the evidence file, the property test, and the BL-914 ticket.

## Evidence document review against its own ticket

- Host load recorded before any isolation run (QA procedure step 1): `uptime`
  output present at the top of the evidence file, with core count.
- All five inventoried failures run in isolation, not just "the file passes"
  (QA procedure step 2) — confirmed each of the 5 rows has its own isolated
  run(s) with duration and load recorded.
- Full-suite re-run on the same host state (QA procedure step 3): present,
  6 failures across 5 files recorded; the divergence from the original
  5-failure inventory is explicitly reconciled per the ticket's own "an
  eighth failure is not to be invented" instruction — the 4 new failures
  are recorded as an out-of-inventory observation, not silently folded in
  or silently dropped.
- Each classification checked against its own evidence (QA procedure step
  4): no row is left as a bare "environmental" — the two classification
  buckets used ("Real slowdown past the 20s budget (marginal)" and
  "Load-induced starvation") each carry a specific isolated-run number and
  load reading. #1/#5/#6/#7 (real slowdown / high-variance) get a
  consequence (BL-914); #2 (comfortable isolated margin) gets an explicit
  argued no-fix-needed reason, per the ticket's own required consequence
  column.
- The 119 `onTaskUpdate` worker-RPC errors are addressed as required,
  classified as a consequence of the same saturation rather than an
  independent suite-infra defect, with a directly-observed same-session
  repro cited as corroboration.

## Invariants review (BL-654)

Ticket declares 1 invariant: *"Every failure in the inventory ends the
slice with a recorded classification and the isolation evidence behind it;
none is left as an unexamined 'environmental'."* This quantifies over the
evidence MARKDOWN document's completeness, not a pure code module's
behavior — the coder's own commit message states this explicitly and
encodes the closest executable form: parsing the evidence document and
asserting every one of the 5 required failure identifiers appears, carries
a recognized specific classification token, and never a bare
"environmental" (`extension/test/bl815EvidenceClassificationComplete.property.test.js`).

Existence and non-vacuity checked BEFORE hand-verifying the property
itself, per this role's own Invariants Review order:
- Independently re-ran: `npm run test:properties -- test/bl815EvidenceClassificationComplete.property.test.js` — 2/2 PASS.
- Non-vacuous: the second test in the file proves the checker actually
  rejects 3 distinct deliberately-broken evidence shapes (a dropped
  classification row, a bare "environmental" substitution, a renamed
  `## Classification` heading) — all via string transforms of the real
  file's content, never mutating the committed evidence file itself, so
  nothing needs restoring afterward. Read the implementation
  (`assertEveryFailureClassified`) directly; the checks are specific to
  the failure classes they claim to catch, not a vacuous always-throw or
  always-pass.

Only after confirming the property test is real and non-vacuous did I
hand-verify the underlying claim (the evidence document review above).

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js
test/bl815EvidenceClassificationComplete.property.test.js` — PASSED, no
forbidden edges.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against all 3 changed files
— no "SUSPECTED COUPLING" flags at all. The property test, the evidence
file, and the BL-914 ticket are all new and self-contained.

## BL-914 (the minted follow-on ticket)

Minted under this ticket's own explicit 1:N permission ("Then the fix
tickets that classification justifies, minimally scoped" — the description's
own closing line; `approval_context` also cites "decision 1's 1:N
permission"). Filed to `backlog/paused/`, not `active/` — no scope creep,
correctly queued rather than self-promoted. Scope matches the evidence:
per-test timeout override for the 4 real-subprocess/real-render tests,
explicitly forbidding a change to the global `testTimeout`, mirroring the
cited BL-362 precedent.

## Acceptance

`acceptance:` correctly stays a `.feature.draft` per the ticket's own
explicit reasoning (no runtime behavior to drive a step handler against) —
confirmed the ticket's `acceptance:` field was not repointed at a live path
and no `.feature` file was created for this ticket.

No violations found. Forwarding to hardender.

By architect.
