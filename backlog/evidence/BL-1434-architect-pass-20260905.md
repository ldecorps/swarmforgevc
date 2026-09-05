# BL-1434 — architect pass, 2026-09-05

Ticket: BL-1434-the-host-activity-feed-property-registers-its-trials
Role: architect
Commit reviewed: 3dce6a65d5 (cleaner NONE pass)

This ticket closes the out-of-parcel finding I flagged during my own
BL-1206 review (`backlog/evidence/BL-1206-architect-pass-20260905.md`) —
the `hostActivityFeed.property.test.js` register row was factually wrong
about the file's own defect and would have orphaned on BL-1206's closure.
Reviewing this parcel with that history in mind.

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.` Test-file conversion plus two data-register edits and
  a new step handler — no production module changed
  (`extension/src/bridge/hostActivityFeed.ts` confirmed untouched by
  `git diff` across the whole parcel), no webview, no VS Code API, no
  secrets, no browser storage.
- **Co-change report**: nothing suspicious beyond this ticket's own family
  and its collateral fix's file.
- **jscpd**, independently re-run on the three touched/new files: 1 clone,
  confined entirely within `bl1175PropertySuiteStandingRedsInvariants.property.test.js`
  itself — confirmed pre-existing by extracting that file's content one
  commit before this ticket's diff and re-running jscpd on it alone:
  identical clone shape and size, shifted only by this ticket's own
  insertion. Correctly out of scope, left untouched.
- **Register check**: `swarmforge/scripts/property_suite_standing_allowlist.tsv`
  is now header-only (confirmed by reading it directly); `grep -c
  hostActivityFeed` on both `backlog/standing-reds.tsv` and the allowlist
  is 0/0. The one remaining `backlog/standing-reds.tsv` data row
  (`pricingTable.test.js`, unit-lane, owned by BL-1212) is unrelated —
  confirmed this ticket's mechanism only ever touched the property-lane
  allowlist and the one row it owned in the general register.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"The conversion weakens nothing"** — read the converted test file
   directly: all five original checks (active status, bound respected, no
   invented line, suffix matches emitted, quiet after end) are real
   `assert` calls inside one `test(...)` body, using vitest's `globals:
   true` convention (confirmed in `vitest.properties.config.mjs`) the
   same way every sibling property file does. Independently confirmed
   non-vacuity myself (not just trusted): ran with
   `BL1434_INJECT_INVENTED_LINE=1` — **the test genuinely fails**, naming
   `invented line INVENTED-L0-45-429`, via the module's own pre-existing
   `__setHostActivityAppendHookForTests` seam (confirmed a real export in
   `hostActivityFeed.ts`, not fabricated) — a red vitest run, not a
   swallowed `process.exit`.
2. **"A land that turns the test green removes its register row and its
   allowlist row in the same commit"** — confirmed both rows gone at this
   commit (above); acceptance scenario 04 reads both TSVs directly and
   independently confirms the same.
3. **"Nothing about extension/src/bridge/hostActivityFeed.ts changes"** —
   `git diff 3dce6a65d5~3 3dce6a65d5 -- extension/src/bridge/hostActivityFeed.ts`
   is empty, confirmed myself. Only the test file, the two registers, and
   the new step handler changed.

## Independently re-verified the substance

- `npx vitest run --config vitest.properties.config.mjs
  test/hostActivityFeed.property.test.js` — **1/1 pass** (the file now
  genuinely registers and runs its forty trials, closing the exact defect
  I flagged in BL-1206's review).
- Same, with `BL1434_INJECT_INVENTED_LINE=1` — **fails**, reproducing the
  non-vacuity proof independently.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1175PropertySuiteStandingRedsInvariants.property.test.js` —
  **3/3 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1434-the-host-activity-feed-property-registers-its-trials.feature`
  — **4/4 pass**.
- `test/bl1367ApprovalCarriesItsRuling.property.test.js` (the one full-suite
  flake the cleaner's evidence names) — ran solo myself: **2/2 pass**,
  confirming it is unrelated to this diff and the known
  clean-alone/red-in-full-lane flake class, not a regression this ticket
  introduces.

## Collateral fix scope judgment

BL-1434 legitimately empties `property_suite_standing_allowlist.tsv` (the
last remaining row), which broke
`bl1175PropertySuiteStandingRedsInvariants.property.test.js`'s own two
invariants: invariant 1's hardcoded non-empty floor (contradicted its own
prior BL-1430 comment that the structural per-row checks were always the
real invariant) and invariant 2's borrowing of a real filename from
`readInventory()[0]` (throws on an empty array). Agree with the fix:
invariant 1's floor is correctly dropped (zero rows is the legitimate best
outcome, not a breakage signal); invariant 2's `mkIsolatedGuard()` runs an
isolated copy of the real guard script plus its three sourced libs against
a synthetic allowlist row in a temp directory, never touching the live
project's own TSV — correctly extending this repo's own "never mutate the
live checkout" convention (BL-1390) to a config file rather than a git
operation. This stays in-scope: it is a fix to a DIFFERENT test file's own
guard test, not `extension/src`, so invariant 3 is unaffected, and it is
directly caused by this parcel's own legitimate effect (emptying the last
row) rather than an unrelated opportunistic change.

## required_wiring

- `extension/test/hostActivityFeed.property.test.js::vitest` — confirmed:
  the file now contains a `test(...)` call and is collected/passing.
- `specs/pipeline/steps/bl1434HostActivityFeedPropertyRegistersSteps.js::registerSteps` —
  present, discovered by directory scan (BL-1371), confirmed by the
  acceptance run passing 4/4.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. The gap I originally flagged
during BL-1206's review is genuinely closed. Forwarding to hardener.
