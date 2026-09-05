# BL-1428 — architect pass, 2026-09-05

Ticket: BL-1428-every-standing-red-names-an-open-owner
Role: architect
Commit reviewed: 0ceb4d5df8 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1428StandingRedRegisterSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is Babashka scripts (`standing_red_register_lib.bb`,
  `standing_red_register_cli.bb`), a shell commit guard
  (`check_standing_red_register.sh`), a data cleanup
  (`property_suite_standing_allowlist.tsv`), and a hand-kept guard-list
  copy (`bl1252CommitGuardAggregationInvariants.property.test.js`'s
  `INDEX_GUARDS`) — no webview, no VS Code API, no secrets, no browser
  storage.
- **Co-change report**: self-referential family only for the new lib/CLI
  pair (their own tests, steps, manifest row) plus `run_commit_guards.sh`'s
  pre-existing expected coupling with `bl1252...property.test.js` — nothing
  new or suspicious.

## Invariants Review (BL-633/654)

1. **One notion of a standing red.** Read `standing_red_register_lib.bb`:
   `build-report` is the sole join of the three sources (allowlist,
   ledger, register); `standing_red_register_cli.bb` is a thin IO wrapper
   over it with no independent ownership logic. `check_standing_red_register.sh`
   deliberately does NOT load-file the CLI (a `*_cli.bb` entry script runs
   its own `-main` as a load-time side effect — the same BL-1431 load-
   safety lesson this codebase already established) and instead
   re-implements only the much smaller, generic "is this ticket id open"
   predicate in `bb -e`, documented explicitly as a mirror of the same
   rule, never a second read of the TSV/ledger data itself. This is a
   narrow, justified duplication of a primitive, not a second reader of
   the three sources — confirmed by reading both implementations
   side-by-side.
2. **A commit is judged only by rows it touches.** `check_standing_red_register.sh`
   uses `git diff --cached -U0` scoped to each of the three source paths,
   extracting only added (`+`) content lines — pre-existing rows never
   enter the violations check. Independently verified with the real CLI
   fixture wrapper: a pre-existing closed-ticket row plus an unrelated
   staged change → exits 0 (scenario 03); a staged register row naming an
   open/closed/absent ticket → exits 0/1/1 respectively (scenario 02, all
   4 examples).
3. **The allowlist gate's reader is unchanged.** Confirmed by diff:
   `property_suite_standing_allowlist_lib.sh` (the gate's actual reader,
   `check_property_suite_drift.sh`'s consumer) has zero changes in this
   parcel — only the TSV's own rows were edited (5 green rows removed, 20
   red rows' rationale updated to name their register owner).
   Independently ran `npm run test:properties` (full 316-file suite):
   completed clean, exit 0 — confirms the allowlist edit refuses nothing
   new.

## Independently re-verified the substance

- `bb standing_red_register_lib_test_runner.bb` → `ALL PASS`
- `bb bl1428_every_standing_red_names_an_open_owner_property_runner.bb` →
  200 runs each, `ALL PROPERTIES HOLD`, wide coverage across
  covered/orphan-allowlist/orphan-ledger and touches/does-not-touch/staged-
  ok/staged-bad/has-stale-rows branches
- `bash test_run_commit_guards.sh` → 12/12 PASS, including the hand-kept
  `INDEX_GUARDS` copy correctly gaining `check_standing_red_register.sh`
  (no regression to the existing guard-chain aggregation contract)
- `grep -c allowlist property_suite_standing_allowlist.tsv` → 20 (matches
  qa_e2e item 3 exactly); the five named green rows (bl1012, bl593, bl632,
  bl687, selfHealTelemetry) confirmed absent by grep
- `grep -n check_standing_red_register.sh run_commit_guards.sh` → present
  in tier 1 (cheap tier), matching the ticket's own `required_wiring`
  anchor and its own "same cost class as the other cheap-tier guards" note

## A real, live finding surfaced by the coder — correctly scoped out

Running `bb standing_red_register_cli.bb .` against the live repo myself:
`count: 32`, 5 `unowned` rows — not the ticket's own qa_e2e item 2 literal
expectation of `unowned: []`. I independently confirmed the coder's own
diagnosis: all 5 unowned rows are `hardening`-lane ledger entries (parcels
BL-620, BL-955, BL-954, BL-956×2, first-seen 2026-08-19) whose owning
tickets I confirmed are all in `backlog/done/M8/` — the work shipped but
the ledger's own drain mechanism (explicitly out of scope for both
`hardening_debt_ledger_lib.bb` and this ticket) never cleared the row. All
27 REGISTER-only rows resolve open (confirmed via my own run of scenario
04's live-tree fixture: `allFound: true, count: 27`) — exactly matching
the qa_e2e item's intent when read against the register alone rather than
the combined report. This is the register correctly surfacing pre-existing
ledger drift it was never asked to fix, not a defect in this parcel — the
coder documented it transparently rather than silently "fixing" it out of
scope or silently ignoring the qa_e2e mismatch.

## Acceptance wiring — driven end-to-end myself

Feature declares 4 scenarios / 7 scenario runs. Independently ran all 4
CLI fixture modes (`report`, `guard <paused|active|done|none>`,
`guard-pre-existing`, `live-register`) directly against
`bl1428StandingRedRegisterCli.bb` — all 7 runs produced exactly the
expected shape, matching the feature's assertions. `registerSteps` export
present per the ticket's `required_wiring` anchor (BL-1371).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. This is the first of three
pieces the human directed on 2026-09-05 ("go" to the standing-red register
proposal); BL-816 was correctly retired as superseded, its human sentence
carried verbatim per Article 5.3. Forwarding to hardener.
