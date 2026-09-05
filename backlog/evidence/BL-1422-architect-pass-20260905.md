# BL-1422 — architect pass, 2026-09-05

Ticket: BL-1422-work-note-not-completed-without-work
Role: architect
Commit reviewed: 099ad0e732 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1422WorkNoteNotCompletedWithoutWorkSteps.js`)
  and full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in
  both. The change is entirely in Babashka daemon/mailbox scripts
  (`done_with_current_task.bb`, `dispatch_lib.bb`, `done_with_current.bb`,
  new pure lib `work_note_evidence_lib.bb`) and a Node step handler using
  only `node:assert`, `node:fs`, `node:path`, `node:child_process` — no
  webview import, no VS Code API, no secrets, no browser storage.
  `work_note_evidence_lib.bb` follows the established pure-lib/impure-
  orchestration split (BL-654's provider_auth_observe_lib.bb precedent):
  the two decision functions are pure and side-effect-free;
  `done_with_current_task.bb` does all the IO (git log, mailbox reads).
- **Invariant 2 (single parser)**: confirmed by grep that
  `dispatch-trail-ticket-id` (chase_sweep_lib.bb, BL-1223) is the only
  definition consulted — `work_note_evidence_lib.bb`'s wrapper delegates to
  it directly, no second regex introduced anywhere in the diff.
- **Co-change report** on the four changed/new core files: only the
  expected `done_with_current*`/`ready_for_next*` sibling family and their
  own test/step files — pre-existing structural coupling for this file
  family, nothing new or suspicious.

## Invariants Review (BL-633/654)

Ticket declares three invariants; the property runner
(`bl1422_work_note_not_completed_without_work_property_runner.bb`) encodes
all three as two properties (P1 = invariants 1+3, the full decision table;
P2 = invariant 2, the single-parser equivalence), each shown non-vacuous by
the coder's own break-then-fix record
(`backlog/evidence/BL-1422-coder-20260905.md`). Independently re-ran it:

```
generator coverage: {:p1-nil-ticket 136, :p1-has-reason 271, :p1-evidenced-no-reason 112, :p1-refuse-case 81, :p2-dispatch-form 208, :p2-no-match 292}
bl1422 work-note-not-completed-without-work properties: 500 runs each
ALL PROPERTIES HOLD
```

All buckets well above the runs/10 floor. Also independently re-ran both
shell test suites:

```
bash test_done_with_current_work_note_evidence.sh   → 9/9 PASS (incl. the
  exact 28-chase-notes-plus-Work-note burst replay from the incident)
bash test_done_with_current_arg_rejection.sh        → 8/8 PASS (BL-652
  regression: --help/-h/bad --no-work shapes still refused; plain
  argumentless completion unaffected)
```

## Acceptance wiring

Feature declares 5 scenarios / 7 scenario runs. I independently drove
`bl1422WorkNoteNotCompletedWithoutWorkSteps.js::registerSteps` against all
7 runs with my own harness (not reusing the coder/cleaner's invocation) —
all passed, including the burst-replay scenario (28 chase notes completed,
then refuses at the Work note). `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371);
`grep -n dispatch-trail-ticket-id swarmforge/scripts/done_with_current_task.bb`
matches (via `work-note-ticket-id` calling into
`work-note-evidence-lib/work-note-ticket-id-from-message`, which itself
calls `chase-sweep-lib/dispatch-trail-ticket-id` — satisfies the other
`required_wiring` anchor's intent, not merely its literal string; verified
by tracing the call chain, not grep alone).

## Notable design point checked for correctness

`refuse-unexpected-args!`/`run-dispatch-forwarding-args!` forwards
`--no-work` argv uniformly through `done_with_current.bb` regardless of
receive mode. For a batch-mode role this reaches
`done_with_current_batch.bb`, which has no Work-note gate (explicitly out
of scope per the ticket: "batch roles receive git_handoffs, not Work
notes") — the reason is accepted at the argv layer and silently unused,
never mis-refused and never silently misapplied to something it shouldn't
touch. Confirmed this is inert rather than broken by reading
`done_with_current_batch.bb`: it never reads a `--no-work` value.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
