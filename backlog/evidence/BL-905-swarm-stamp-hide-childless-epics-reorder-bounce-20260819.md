# BL-905 architect bounce — 2026-08-19

## Reviewed commit
`16d7301e317ce853765e9d3f9470a67d5824ed3d` ("BL-905: certify the landed
hide-childless-epics hotfix; add its acceptance coverage", By coder,
forwarded unchanged by cleaner). This is a certify-review ticket: the
production behavior is already on `main` at `0f5394a2d0` ("Land
hide-childless-epics reorder screen fix", authored outside the pipeline by
Cursor). The genuinely new artifact in this parcel is
`specs/pipeline/steps/bl905HideChildlessEpicsReorderSteps.js`.

## What passed
- Dependency-rule gate (`node extension/out/tools/dependency-gate.js`) run
  against the certified production files (`bridgeServer.ts`,
  `epicTopicSlugMatch.ts`, `epicReorderUiHtml.ts`, per this ticket's own
  instruction to run every gate on `0f5394a2d0` for the first time): PASSED,
  no forbidden edges.
- Co-change report on the same files: `bridgeServer.ts`'s flagged coupling
  is its normal pre-existing high-churn pattern (a large shared route file);
  nothing new or specific to this change.
- **Invariant 1** ("tile list and Move up/down neighbours always derived
  from one read"): confirmed directly in the hotfix diff — both
  `computeEpicReorderState` (GET `/epic-reorder-state`) and
  `handleEpicReorderMoveRoute` (POST `/epic-reorder/move`) call the same
  `readEpicReorderMembership(targetPath)` and consume its `reorderable`
  field. No second, divergent reader exists.
- **Invariant 2** ("hiding is presentation-only; make-top unaffected"):
  `filterEpicsWithTopics` only filters an in-memory array — no write/move
  call anywhere in it or its caller. `handleEpicMakeTopRoute` reads via
  `readLiveBacklogItems`, a function this hotfix never touches and which is
  wholly independent of `readPausedEpics`/`readEpicReorderMembership`.
  Confirmed by reading the route handler directly, not by trusting the
  commit message.
- Both invariants are exercised end-to-end by the new acceptance scenarios
  (04/05 for invariant 1, 04/06 for invariant 2), and the coder's
  non-vacuity check (reverting the filter and observing 5/9 scenarios fail)
  is real evidence, not an assertion. I am not bouncing for a missing
  invariant property test here — unlike a prior parcel this session, the
  coder here actively engaged with both declared invariants, backed by a
  real revert-and-recompile check, and the underlying production code
  predates this parcel (authored outside the pipeline, not newly introduced
  by this ticket's coder).
- `filterEpicsWithTopics`, `bridgeServer.ts` wiring: read start to finish
  against the three locked bullets (done-exclusion, self-child exclusion,
  slug resolution via BL-686) — all hold as coded.

## D1 — fixture-dir leak in the new step-handler file (blamed: coder, class: behavior)

`specs/pipeline/steps/bl905HideChildlessEpicsReorderSteps.js`'s `mkFixture()`
(line 38) creates a fresh directory via `fs.mkdtempSync(path.join(os.tmpdir(),
'sfvc-bl905-'))` for every scenario. Nothing in the file ever removes it —
the file's one `finally` (line 94, inside `withBridge`) only stops the
bridge server, never touches `ctx.root`. There is no framework-level sweep
either: `specs/pipeline/stepRegistry.js` and `runtime.js` have no
after-scenario/teardown hook, and no other file in `specs/pipeline/` cleans
up an `sfvc-*` prefix.

This is the exact rule in `engineering.prompt`'s Test Speed And Isolation
section: *"A fixture dir from `fs.mkdtempSync` is removed in a `finally`,
never only after the last assertion — a test that throws or bounces
otherwise leaks it permanently."* It is also the exact defect class QA
bounced on this ticket's sibling `BL-927` for
(`backlog/evidence/BL-927-rotate-gate-resolves-departing-role-from-the-raw-marker-bounce-20260819.md`),
fixed there via a `cleanupFixture(ctx)` helper
(idempotent `fs.rmSync(ctx.dir, {recursive:true,force:true})`) wrapped in
`try/finally` around every step that can throw
(`backlog/evidence/BL-927-fixture-leak-fix-architect-pass-20260819.md`,
merged into this worktree earlier in this same session).

**Measured, not inferred**: counted `$TMPDIR/sfvc-bl905-*` directories
before and after one run of
`node specs/pipeline/cli.js specs/features/BL-905-hide-childless-epics-reorder.feature`
(9/9 scenarios pass): 36 → 45. Exactly 9 new leaked directories, one per
scenario, zero cleaned up.

**Remediation**: add a `cleanupFixture(ctx)` helper on the same shape as
BL-927's fix and wire it into every step that can leave `ctx.root` set
without reaching a normal cleanup path — either a per-scenario
try/finally around each Given/When step body, or (cleaner here, since every
scenario's flow is linear through `mkFixture()` then several steps) a
single wrap at the level this framework supports for a whole scenario. Sibling
files `bl572EpicReorderConsoleSteps.js` and `bl672EpicMakeTopPrioritySteps.js`
share the same `mkdtempSync('sfvc-<ticket>-')` shape and the same absence of
cleanup — out of scope for this bounce (BL-905 touches only its own new
file), but worth a `note` if the pattern recurs project-wide; not filing one
now since BL-927's fix already exists as the precedent to copy and this
bounce's remediation is unambiguous without it.

## Inventory completeness
This is the whole review pass. No check was blocked by D1; the invariant
review and architecture checks above all completed independently of it.
