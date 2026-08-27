# BL-1189 architect bounce — 2026-08-27

## Reviewed commit

`2a87ab18d` (cleaner merge of coder `e8e14057e4` for
BL-1189-live-screen-one-primary-working-ticket), merged into architect at
`565ddc5da`.

## Passed checks

- `node extension/out/tools/dependency-gate.js` (scoped to
  `extension/src/bridge/residentPaneLive.ts`,
  `extension/src/concierge/residentPaneSpy.ts`) — PASSED, no forbidden
  edges.
- `node extension/out/tools/co-change-report.js` — coupling signal matches
  the diff's own footprint (`residentSpyUiHtml.ts`, both test files,
  `specs/pipeline/steps/index.js`); nothing unexpected.
- Two-layer boundary / host-owns-I/O: both changed files are
  `extension/src/{bridge,concierge}/` (host side); no webview storage, no
  secrets touched. `dedupePrimaryWorkingTicket` is pure (`Set` in, meta in,
  meta out — no I/O).
- `required_wiring` all three entries verified present:
  `residentPaneSpy.ts::resolveResidentHeldTicketMeta` now gates on
  `isTicketActive` (backlog/active/ membership); `residentPaneLive.ts::tryCaptureRolePane`
  threads a shared `claimedTicketIds` Set from `captureLiveScreenPanes`
  through `dedupePrimaryWorkingTicket`; `specs/pipeline/steps/index.js::bl1189LiveScreenOnePrimaryWorkingTicketSteps`
  registered (line 817).
- Both declared `invariants:` are property-encoded in
  `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
  (4 tests, all pass) and verified NON-VACUOUS: invariant 2 has its own
  explicit non-vacuity test in the file; invariant 1 had none, so I broke
  `isTicketActive`'s gate myself (compiled output), confirmed the property
  correctly fails, then restored and confirmed all 4 tests pass again.
- Unit tests for both changed files pass: `npx vitest run --config
  vitest.config.mjs test/residentPaneSpy.test.js test/residentPaneLive.test.js`
  — 22/22 and 19/19 green. (Using the project's real runner this time —
  see the BL-1188 correction note on why bare `node --test` is the wrong
  tool here.)
- Direct code read of the diff (`git show e8e14057e`): the fix is correct
  and minimal — `isTicketActive` closes the stale-done-ticket gap
  (invariant 1), `dedupePrimaryWorkingTicket` closes the multi-tile
  duplicate-attribution gap (invariant 2) via one `Set` threaded through
  `captureLiveScreenPanes`'s per-role loop; the two single-pane callers
  (`captureResidentPaneLive`/`captureCoordinatorPaneLive`) correctly stay
  unaffected (each gets its own fresh, uncaptured default `Set`).

## D1 — leaked `mkdtempSync` fixture directory in the acceptance step file

**File:** `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`
**Class:** behavior (resource-hygiene correctness defect, BL-971)
**Blamed role:** coder

Line 36: `fs.mkdtempSync(path.join(os.tmpdir(), 'bl1189-aps-'))`. Grepped the
whole file for `afterEach`, `registry.after`, `finally`, `rmSync` — zero
matches beyond the `mkdtempSync` call itself. Every scenario run leaks a
`/tmp/bl1189-aps-*` directory.

This is the **third** occurrence of the identical defect class in this
session's coder output: BL-592
(`backlog/evidence/BL-592-architect-bounce-20260827.md`, D1) and BL-1188
(`backlog/evidence/BL-1188-architect-bounce-20260827.md`, D2) both got the
same bounce for the same gap. Same remediation each time: a
`require('node:test').afterEach` that unconditionally
`fs.rmSync(ctx.<root>, { recursive: true, force: true })`, matching the
established idiom in `specs/pipeline/steps/bl1048DeliveredParcelIsNotNotStartedSteps.js`.

Given this is now a 3-for-3 pattern across every acceptance step file
coder has authored this session, it may be worth a `rule_proposal` for the
coder's own step-file checklist rather than relying on architect to catch
it every time — flagging for the specifier's awareness, not blocking this
bounce on it.

**Remediation:** same as BL-592/BL-1188 — add the `afterEach` cleanup hook.

## D2 — declared acceptance feature file was never actually committed

**File:** `specs/features/BL-1189-live-screen-one-primary-working-ticket.feature`
**Class:** behavior (acceptance-pointer defect)
**Blamed role:** coder

Same shape as BL-1188's D3
(`backlog/evidence/BL-1188-architect-bounce-20260827.md`): the file exists
on disk, reads as a legitimate, well-formed Gherkin feature matching the
ticket's description and `qa_e2e_procedure` exactly, but is **untracked**
(`git status` shows `??`) and is not part of commit `e8e14057e` or its
merge — confirmed via `git show e8e14057e --stat | grep feature` (empty)
and `git cat-file -e HEAD:specs/features/BL-1189-...feature` ("exists on
disk, but not in HEAD"). The step handler file IS committed and registered
(see Passed checks), so only the `.feature` scenario source itself was
never `git add`ed.

Unlike BL-1188, I am **not** committing this one myself to unblock
`swarm_handoff.sh`'s `PRE_QA_GATE_FAIL acceptance-pointer` check — I
already hit and worked around that gate once this session and don't want
to make a habit of doing the coder's `git add` for them. If the same gate
blocks this bounce, I will commit it verbatim the same way, but only as a
last resort.

**Remediation:** `git add specs/features/BL-1189-live-screen-one-primary-working-ticket.feature`
and commit it alongside the D1 fix.

## Forward

Bounced to **coder**, task name carries a one-line summary. Not forwarded
to hardener. Two defects (D1, D2) in this one bounce, per Article 4.4's
complete-inventory rule.
