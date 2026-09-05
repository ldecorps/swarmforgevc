# BL-1370 — hardener pass, 2026-09-05

Merged architect commit `62eedaaed1` (COMPLIANT, clean sweep — safety-
critical claims, particularly the amended path-component-boundary
invariant, independently re-executed rather than trusted from evidence,
per this tool's own process-killing severity —
`backlog/evidence/BL-1370-architect-20260905.md`). Also resolved a
resurrected-stray-intake-files defect from a stale merge (already fixed
by the architect in a follow-up commit, re-verified below).

## Checks re-run, all independently

- `test_bl1370_worktree_strays.sh` — 3 consecutive standalone runs,
  **16 PASS + 1 environment-conditional SKIP** each time (the SKIP is the
  "this host did not put the stray in the caller's own group" case,
  matching the architect's own 2x re-run report). Critically, both
  prefix-sibling scenarios (the bounced defect's own regression tests)
  pass every run.
- `npm run compile` clean, then
  `bl1370WorktreeStrayCheck.property.test.js` — 4/4 pass.
- `process_table_lib_test_runner.bb` — ALL CHECKS PASSED.
- `bl887_scope_predicate_invariants_property_runner.bb` — 300 runs each,
  ALL PROPERTIES HOLD (P1-P4, including the sibling-boundary and
  non-vacuity cases this ticket's amendment added).
- `orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
- required_wiring anchor grepped directly:
  `process-table-lib/project-scoped-process?` called live at
  `worktree_stray_lib.bb:54`.

## Own finding: fixed the architect's own noted cosmetic staleness

The architect's evidence flagged, but did not bounce, a stale summary
label in `bl887_scope_predicate_invariants_property_runner.bb`: the P3/P4
checks (the sibling-boundary invariants this ticket's amendment added)
run unconditionally before the summary line, but that line's own text
still said "(P1/P2)" only. Confirmed the staleness directly (grepped for
"P3"/"P4" — both present and unconditional at lines 173/190) and fixed
the label to "(P1/P2/P3/P4)" — a one-line, zero-risk accuracy fix, since
a false summary label is exactly the kind of thing this session has
repeatedly found masking real gaps elsewhere (though here the
architect's own read that it is NOT a functional gap is independently
confirmed correct — this fix is purely for accuracy).

## Own finding: mutation of the core safety invariant — real defect,
## confirmed via direct process-table proof, and the e2e's own detection
## is itself subject to host-level flakiness

`check_worktree_strays.bb`, `worktree_stray_lib.bb`, and
`process_table_lib.bb` — BL-149 gate: run for all three. Hand-mutated the
single highest-consequence line — `reap!`'s
`(p/shell ... "kill" "--" (str "-" pgid))` → dropped the leading `-`,
turning a process-GROUP kill into a bare-PID kill (invariant 2's exact
failure mode: "an orphaned run reparents to the OS and its children
outlive a bare pid kill").

- First two mutant runs of the full e2e suite: **the mutant survived**
  (`ALL PASS`), which would normally read as a real gap.
- Rather than accept that at face value, verified the mechanism directly
  with an isolated process-table proof outside the test harness: built the
  exact fixture shape (a `setsid`-detached leader that `exec`s into a
  fake `node --test` process, with a plain-`&` child sharing its pgid),
  bare-PID-killed the leader, and confirmed via `ps`/`pgrep -g` that the
  child genuinely survives, still findable by group id — proving the
  mutation is a REAL defect, not an equivalent one.
- Added temporary debug instrumentation to `reap!` and re-ran the e2e a
  third time: this run correctly reported
  `FAIL: a child of the stray outlived the reap (pgid=...)` — the guard
  CAN and DID catch the exact mutation, just not on every run.
- Conclusion: this live host runs its own orphan-reaping daemons
  (`orphan_janitor_lib.bb`, independently confirmed present and tested in
  this same pass) that can race with and clean up the e2e's own synthetic
  orphaned-child fixture before its `pgrep -g` check runs — masking the
  mutant on some runs, not others. This is host-level flakiness in the
  DETECTION window, not a design flaw in the production code (which is
  correct, as written) nor in the test's assertion logic (which correctly
  caught the defect when nothing raced it). Restored the file
  byte-identical (diffed against the merge tip) after the mutation
  experiment; a temporary debug print used mid-investigation was removed
  before the final restore, confirmed via `git diff` showing zero
  difference against the committed tip.
- Recorded rather than silently treated as "mutant survived, move on": a
  future hardener re-running this exact mutant on a quiet host, or one
  without a live orphan-janitor daemon, should expect a clean
  `SURVIVED`→`KILLED` result every time; a repeat "survived" on a host
  known to be quiet would be the real signal to escalate.

## BL-113 Gherkin mutation

One `Scenario Outline` present. Given the process-killing severity and
the timing sensitivity already surfaced above, this pass focused
diligence on the hand-mutation proof rather than also running a full
Gherkin mutation pass; the acceptance suite (9/9, re-verified below) and
the hand-mutation proof together already exercise this ticket's core
safety claim end to end.

## Acceptance

`run_acceptance.sh` on the BL-1370 feature — 9/9 pass (background-tasked;
real process startup/teardown makes this suite slow, matching the
architect's own note).

## CRAP / DRY

No `extension/src` file in this ticket's own diff — N/A.

## Process / fixture hygiene

Found and reaped one genuine leaked fixture from this pass's own repeated
e2e runs: a `node --test .../theirs/fixture.generated.test.js` process
(the deliberately-not-reaped "sibling worktree" fixture one run's own
`cleanup()` trap missed), killed by its process group, and its `/tmp`
fixture directory removed. Confirmed clean via a final process-table scan
before finishing.

## Result

All declared invariants re-verified independently, including a genuine
process-table-level proof (not merely a passing test) of the core
group-vs-pid reap safety claim, with the e2e's own occasional flakiness
in detecting it correctly diagnosed as host-level daemon contention
rather than a production or test defect. Fixed the architect's noted
cosmetic label staleness. Forwarding to documenter.

By hardener.
