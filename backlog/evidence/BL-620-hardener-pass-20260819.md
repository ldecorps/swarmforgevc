# BL-620 hardener pass — 2026-08-19

## Reviewed commit
`6a5113769d` ("BL-620: architect pass - clean, forwarding to hardener"),
merged into hardener as this parcel. No bounce.

## Scope, precisely
`git show --stat bdab5ce61` — 7 files: `messageTextOf`'s caption fallback,
`checkUpdateEligibility`'s `media-no-caption` reason,
`annotateRoutedMediaText`, the drop-audit emit, plus the new test files,
step handler and registry line. **This is the first parcel this session
that genuinely touches `extension/src/*.ts`** — Stryker/CRAP/DRY are
applicable and were run, unlike every other ticket hardened today.

## Coverage gap closed (flagged by the architect for this pass)
The architect's evidence explicitly noted `frontDeskDropAudit.property.test.js`
had no `test('non-vacuity: ...')` block, unlike every sibling
`.property.test.js` in this repo — the architect proved the break by hand
(removing the source-level audit-emit call) but that verification does not
persist as a regression guard. Since `pollAndForward` has no swappable
"defective variant" export to import (unlike e.g.
`renderDailyTrendDefective`), I followed this repo's OTHER established
non-vacuity idiom for exactly this situation
(`bl628AutonomousHostBootstrapInvariants.property.test.js`'s own
non-vacuity tests: prove the CHECKER's comparison logic discriminates
broken from correct, via a hand-built broken scenario, rather than a
swappable implementation) — added
`test('non-vacuity: the property fails when a drop happens but no audit
line was emitted for it', ...)`. **Independently verified the new test
itself is not vacuous**: fed the "fixed" (correct) scenario into the same
assertion shape and confirmed `assert.throws` itself throws
("Missing expected exception"), proving the guard genuinely discriminates
rather than always passing.

## A real CRAP regression, found and fixed
`processMessageUpdate` scored CRAP=8.00 (complexity=8, 100% coverage) —
over the CRAP<=6 threshold. Traced via `git diff bdab5ce61^ bdab5ce61`:
this function was **already** over threshold before BL-620 (complexity 7,
CRAP=7.00 pre-existing, confirmed by inspecting the diff — BL-620 added
exactly one new `if (decision.action === 'drop')` branch, +1 complexity),
so this ticket's own small addition pushed a pre-existing violation
further. This matches the accepted 2026-08-13 rule_proposal precedent
(bridgeServer.ts's `tryServeSideloadApk` extraction) — a route/branch
added to an already-complex dispatcher inherits and compounds its debt
unless extracted first.

**Fix**: extracted the new branch (not just its body) into
`emitDropAuditIfDropped(decision, update, adapters)`, a small,
self-contained helper (checks `decision.action` itself, safe to call
unconditionally). `processMessageUpdate` dropped back to complexity=7 /
CRAP=7.00 — its **pre-existing baseline**, no longer worsened by this
ticket's own change — and the new helper scores CRAP=2.00, well clear of
the threshold. `processMessageUpdate`'s remaining CRAP=7.00 is pre-existing
debt from its other four decision branches, unrelated to and not
introduced by BL-620; bringing the whole dispatcher under 6 is a larger
refactor outside this ticket's and this pass's scope, matching the
precedent's own framing ("the new code carries its own isolated score",
not "the whole dispatcher must comply").

**Independently verified behavior-preserving**: recompiled, re-ran the
full unit suite (388/388, unchanged), the property test (2/2), and the
full acceptance feature (13/13, unchanged) after the extraction — no
regression, `git diff` on the extraction is minimal (14 inserted lines,
1 line replaced, both in `telegramFrontDeskBotCore.ts` only).

## Checks run (complete inventory, not first-failure-stop)

1. **Independent re-run of both existing test files**: `npx vitest run
   test/telegramFrontDeskBotCore.test.js` — 388/388 pass. `npx vitest run
   --config vitest.properties.config.mjs test/frontDeskDropAudit.property.test.js`
   — 2/2 pass (after adding the non-vacuity test).
2. **Acceptance, independently re-run**: 13/13 PASS, matching the
   architect's 13/13.
3. **CRAP**: ran `node scripts/crapReport.js` scoped to the 3 changed src
   files (via `npx vitest run --coverage telegramFrontDeskBotCore`, scoped
   coverage rather than the full-suite `npm run coverage`, which this
   sandbox's ~120s foreground cap cannot reliably complete — matches this
   session's own established workaround). Found and fixed the
   `processMessageUpdate` regression above. `attemptVoiceDelivery`'s
   borderline CRAP=6.00 (complexity=6, 96% coverage) is pre-existing,
   untouched by this parcel, and not flagged as newly regressed.
4. **DRY**: `npx jscpd --config .jscpd.json src` — 35 clones total, one of
   which is inside `telegramFrontDeskBotCore.ts` itself (lines 18-72 /
   77-131). **Independently confirmed pre-existing**: ran jscpd against
   the pre-BL-620 version of the file (`git show bdab5ce61^:...`) —
   identical clone at the identical line numbers. Not introduced by this
   parcel. All other 34 clones are in unrelated files (telegramCursorBridge*,
   telegramCursorOperator*, swarmStopper.ts).
5. **Stryker mutation**: attempted, deferred. Host load 14.29/17.21/16.99
   on 4 cores — the BL-149 cooldown gate reported `skip-busy`/`skip-cooldown`
   for all 3 changed files, consistent with the standing rule against even
   a concurrency=1 differential Stryker run above 2x-cores load. **Recorded
   the deferral in the BL-942 hardening-debt ledger** (this session's own
   earlier hardening work), the first real-world entry beyond its
   header-only seed: `hardening_debt_ledger_update.bb --defer BL-620
   mutation <3 files> "host busy..." "14.29/17.21/16.99" 2026-08-19` —
   confirmed readable back via `hardening_debt_ledger_read.bb`.
6. **Standing whole-tree guards**: neither the new step handler nor either
   test file uses `mkdtemp` or starts a tmux server (grepped, zero
   matches) — `tmuxReaperGuard.test.js`/`tmpDirMigrationGuard.test.js`
   structurally do not apply here.
7. **Required wiring**: none declared on this ticket (confirmed by grep).
8. **Leak/process check**: `git status --short` shows only the three
   files I touched (the ledger, the source extraction, the new test);
   no stray processes.

## Outcome
Closed the architect-flagged non-vacuity coverage gap, independently
verified non-vacuous. Found and fixed a genuine CRAP regression on
`processMessageUpdate` via isolation-extraction, independently verified
behavior-preserving across the full unit, property, and acceptance
suites. DRY's one in-file clone confirmed pre-existing, not introduced.
Stryker mutation deferred under a genuinely busy host, recorded durably
in the hardening-debt ledger rather than only in this prose.

Forwarding to documenter.

By hardener.
