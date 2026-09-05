# BL-1212 — architect pass, 2026-09-05

Ticket: BL-1212-real-tree-docs-gate-never-recorded-its-live-read-exemption
Role: architect
Commit reviewed: 420992e4bc (cleaner NONE pass)

## Result: NONE (parcel) — no architecture, invariant, or correctness defect
in the parcel itself. One confirmed spec-gap in the ticket's own qa_e2e
item 3, transparently disclosed by the coder, independently reproduced by
me, routed as a note per this role's spec-gap rule rather than a bounce.

## What changed

`git diff a3d574c48f..420992e4bc -- extension/test/docsStructureRealTree.test.js`
is exactly the 6-line `BL-1038-EXEMPT:` comment block the ticket asks for,
above the `REPO_ROOT` declaration. No other production or test-behavior
diff. Also new: `specs/pipeline/steps/bl1212RealTreeDocsGateRecordsItsLiveReadExemptionSteps.js`
and the coder/cleaner evidence files.

## Checks run

- **Dependency-rule gate**, full-repo (`node extension/out/tools/dependency-gate.js`,
  run with no arguments): `Dependency-rule gate PASSED: no forbidden edges.`
  (The scoped invocation errored on the `specs/...` path — the tool
  resolves paths relative to `extension/`, so a path outside that tree
  isn't openable from repo root; the full-repo scan already covers both
  changed files, so this is a tooling-invocation quirk, not a gap in
  verification.) The change is a test comment plus a new step-handler file
  — no webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: nothing suspicious — the step handler's only
  co-changes are its own coder evidence file and its target test file.

## Invariants Review (BL-633/654)

Declared invariant: "A live-repository read in the unit lane is either
removed or JUSTIFIED IN WRITING — never silently tolerated and never
rubber-stamped: the guard keeps refusing a bare marker, so every exemption
added carries a reason a reader can disagree with."

- Confirmed the exemption is present and states a real reason ("the live
  read is the assertion... single thing this file exists to catch"),
  matching BL-1038's own policy language (`pricingTable.test.js`'s own
  phrasing, per the ticket's own instruction).
- Confirmed via `grep -n "LIVE_ROOT_BINDING_RE"
  extension/test/helpers/liveRepoDerivationGuard.js` that the guard's
  pattern only matches the literal `path.join(__dirname, '..', '..')`
  idiom.
- Independently reproduced the coder's non-vacuity finding myself
  (backup-copy, strip the exemption block via `sed`, rerun the guard test,
  restore byte-identical, confirm `git status --short` is empty
  afterward): `npx vitest run test/liveRepoDerivationGuard.test.js` stays
  **19 passed, 0 failed** whether the exemption comment is present or
  stripped. The invariant's "keeps refusing a bare marker" clause is true
  in general (confirmed by the guard's other 9+ marker-carrying files) but
  is now **inert for this specific file**, because this file's derivation
  no longer matches any pattern the guard's marker-check step even
  reaches — a fact independent of BL-1212's own diff (it is true against
  both `a3d574c48f` and `420992e4bc`).

## Root cause of the gap (independently traced, not just trusted)

- `find backlog -iname "BL-1209*.yaml"` → `backlog/done/BL-1209-mkdtemp-check-loads-its-detector-through-the-subject-root.yaml`
  — the ticket's `depends_on` dependency has landed, so scenario 03's "with
  BL-1209 landed" precondition is real today.
- `docsStructureRealTree.test.js`'s `REPO_ROOT` is derived via
  `execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], ...)`
  — traced to commit `533da24a41` ("BL-1317: hardener pass...",
  2026-09-02), eleven days after BL-1212 was minted (2026-08-27) and
  unrelated to either BL-1212 or BL-1209. That commit silently changed
  this file away from the `path.join(__dirname, '..', '..')` idiom the
  guard's pattern-matcher recognizes, without anyone (BL-1317's own
  reviewers included) checking it against BL-1038's guard — the guard
  itself has no test asserting it still catches every file it caught
  before, so this drift was invisible until BL-1212 revisited the file.

## Acceptance wiring — driven end-to-end myself

Registered and ran all 3 scenarios' steps directly against the real guard
helper and the real file (not a reimplementation):

- **Scenario 01** ("declares a reason for reading the live repository") —
  **PASS**.
- **Scenario 02** ("a bare marker with no reason is still refused") —
  **the step handler itself throws**, deliberately: `CONFIRMED SPEC GAP:
  the guard does not detect docsStructureRealTree.test.js's current
  REPO_ROOT derivation ... stripping the exemption reason produces no
  violation.` I reproduced this exact outcome myself, independent of the
  coder's own step-handler code, via the raw `sed`-strip test above. The
  coder chose to make this failure LOUD (a thrown error naming the gap)
  rather than either faking a pass or silently asserting the ticket's
  stale literal expectation — the correct call given Article 3.6/BL-1006
  ("wrong-at-mint scenario is amended, never silently rubber-stamped").
- **Scenario 03** ("the guard reports no violations across the test
  tree") — **PASS**, 19/19, confirming the ticket's own qa_e2e item 4 (the
  "load-bearing" scenario) is genuinely satisfied today.
- **Regression** (qa_e2e item 5): `npx vitest run
  test/docsStructureRealTree.test.js` — **5 passed, 0 failed**, unaffected
  by the comment addition.

## Update: the specifier had already amended the ticket (985b0df0b6)

Before I could send my own spec-gap note, my first `git_handoff` attempt to
hardener was refused with `CONTRACT_AMENDED_SINCE_BASE`: the ticket's
feature file had been amended on `main` by `985b0df0b6` while this parcel
was in flight — the specifier independently reached the exact same finding
(via the coder's own 2026-09-05T16:33Z note) and retired scenario 02 with a
RETIRE-WITH pointer to a newly-minted BL-1435 (defect, high: widen the
guard to recognize the `git rev-parse` idiom), per Article 5.3/BL-1006. I
had already sent my own priority-`00` note to specifier and coordinator
naming the same gap moments before discovering the amendment — redundant
now but harmless, and it independently corroborates the specifier's own
finding.

Per the in-flight-amendment protocol (this parcel's holder merges `main`
first, then replays the amendment): merged `origin/main` (also picking up
BL-1433, already landed in `backlog/done/M8/`), then updated
`specs/pipeline/steps/bl1212RealTreeDocsGateRecordsItsLiveReadExemptionSteps.js`
to drop scenario 02's now-retired steps and its stale header (replaced with
a note pointing at the retirement commit and BL-1435), removing the now-
unused `violationFor`/`liveRepoDerivation` imports. Re-drove scenarios 01
and 03 directly against the amended feature — both **PASS**. Re-ran
`npx vitest run test/liveRepoDerivationGuard.test.js
test/docsStructureRealTree.test.js` — **24/24 pass** (19 + 5), confirming
the amended acceptance surface and the regression requirement both hold
cleanly with no dangling reference to the retired scenario.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect in the parcel. The spec-gap this pass
surfaced was independently found and already resolved by the specifier
(BL-1212 amended, BL-1435 minted) before this parcel forwarded — replayed
the amendment onto the step-handler file and re-verified green. Forwarding
to hardener.
