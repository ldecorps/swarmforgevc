# BL-1206 — architect pass, 2026-09-05

Ticket: BL-1206-drain-the-node-test-import-entries-from-the-property-allowlist
Role: architect
Commit reviewed: e29ab2d1d0 (cleaner)

## Result: NONE (parcel) — no architecture, invariant, or correctness defect
in this parcel. One out-of-scope register data-quality finding recorded
below and routed as a note, per this role's out-of-parcel-finding rule.

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1206DrainTheNodeTestImportEntriesFromThePropertyAllowlistSteps.js`)
  and full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in
  both. The change is test-side only: 14 one-line import removals, two new
  guard helpers (`nodeTestImportGuard.js` extended for the property lane,
  new `allowlistRemovalGuard.js`), two new live guard tests, and register/
  allowlist bookkeeping — no production diff, no webview, no VS Code API,
  no secrets, no browser storage.
- **Co-change report**: only this ticket's own new family plus its BL-1220
  sibling (the unit-lane analog whose scanner this ticket correctly reuses
  rather than reimplementing) — nothing pre-existing disturbed.

## Invariants, both verified live

1. **No property-lane file binds `test` from node:test.** Ran
   `bl1206PropertyLaneNodeTestImportGuard.test.js` myself: 4/4 pass,
   including "the real extension/test tree has no property-lane node:test
   imports" — a live scan of the actual tree, zero violations. The scanner
   (`findPropertyLaneNodeTestImports`) correctly reuses BL-1220's own
   pure per-line matcher (`findNodeTestImportLines`) rather than a second
   implementation — confirmed by reading the diff: only the lane-scoping
   predicates are new.
2. **A file leaves the allowlist only by passing, never a silent deletion.**
   `allowlistRemovalGuard.js`'s `findSilentRemovals` is pure and
   independently exercised by `bl1206PropertyLaneAllowlistInvariants.property.test.js`'s
   P3, whose non-vacuity is documented (inverting the filter's `!== true`
   to `=== true` fails immediately on the very next generated case) — I
   ran this property test myself (3/3 pass) rather than trusting the
   documentation alone.

## Independently re-verified the substance

- Ran all 14 converted files under the properties config myself: 14/14
  files, 50/50 tests pass — confirms every converted file that was
  removed from the allowlist genuinely passes now (scenario 02's own
  requirement), none silently weakened.
- Ran the full property suite (`npm run test:properties`, 316 files):
  completed clean, exit 0 — no regression from the 14 import removals or
  the two new guard files.
- `git diff` on `backlog/standing-reds.tsv` and the allowlist: exactly the
  14 converted files' rows removed, all other rows (including
  `hostActivityFeed.property.test.js`, the ticket's own required_wiring
  anchor) byte-identical before/after — confirmed by reading the diff
  directly, not by trusting the coder's count.

## Acceptance wiring — driven end-to-end myself

Feature declares 5 scenarios / 7 scenario runs (scenario 04 is a 3-example
Outline). Independently drove
`bl1206DrainTheNodeTestImportEntriesFromThePropertyAllowlistSteps.js::registerSteps`
against all 7 — passed, including scenario 04's three "unrelated cause,
untouched" checks, which compare each named file's register row as read
at THIS ticket's own git-HEAD starting point against the working tree
today (never a fixed literal expectation) — correctly tolerant of two of
the three named files (`selfHealTelemetry`, `unreachableStepHandlerCheck`)
having already left the register entirely via other tickets landing in
between mint and pickup (BL-1428/BL-1229), which the step handler's own
comment explicitly anticipates ("gone by someone else's fix is not
'touched by this parcel'"). `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371); the other anchor (the
`hostActivityFeed.property.test.js` row surviving unchanged) verified by
direct diff.

## Out-of-parcel finding: a register row will orphan the moment this ticket closes

`backlog/standing-reds.tsv`'s sole remaining property row —
`extension/test/hostActivityFeed.property.test.js`, owner `BL-1206`,
rationale `"node:test import; fails collection"` — is, and was already
before this parcel touched anything, **factually wrong about the file's
own defect**. I read the file directly: it has zero `test(...)` calls of
any kind and no `node:test` import at all (`grep -n "\btest("` returns
nothing); it is a bare top-level script that runs assertions and calls
`process.exit(1)` on failure. Vitest's "No test suite found" for this file
is because there is no test registration whatsoever, not because of a
node:test import — a different defect class than every other row this
ticket's mechanism addresses.

This is confirmed pre-existing and deliberately out of THIS ticket's
scope: `git diff` shows this exact row byte-identical before and after
BL-1206's own commits, and the ticket's own acceptance feature (scenario
04) explicitly lists this file as an "allowlisted for a cause other than
the node:test import" example that must stay untouched — the ticket's
author already knew its cause differs, which is exactly right for BL-1206
not to touch it (editing another ticket's owned row would itself violate
the task-scope discipline BL-1192/BL-1424 exist to enforce).

The problem is narrower and belongs to whoever owns the register's data
quality, not to this parcel: once BL-1206 closes, this row's `ticket`
column names a CLOSED ticket for a defect BL-1206 never touched and never
intended to fix — the exact "stale owner outlives its ticket" pattern
BL-1428 itself was built to catch (and which BL-1206's own opening
paragraph names as the general failure mode: "BL-1175 has since landed,
so the allowlist is permanent and the repair it deferred is untracked").
`grep -rl hostActivityFeed backlog/paused backlog/active` returns nothing
beyond BL-1206 itself — no other open ticket names this file. Flagging
here per this role's out-of-parcel-finding rule rather than bouncing the
parcel (which correctly, and by design, does not touch this row) or
silently ignoring it. Sending a note to specifier+coordinator alongside
this pass.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect in the parcel itself. Forwarding to
hardener; separately notifying specifier+coordinator of the
`hostActivityFeed.property.test.js` register-ownership gap this ticket's
closure will create.
