# BL-1338 — hardener pass (20260902)

Received in a 2-item batch with BL-1271 (architect commit `e89e836998`,
forwarded unchanged from cleaner `17b4e11ef4`, on top of coder `69ae1c2ee3`).

## BL-149 cooldown gate

`extension/src/tools/deprecate-check.ts` — **run** (4.07 days old, host
quiet). `swarmforge/scripts/test/dispatch_gap_test_runner.bb` (BL-1271's own
file) — skip-cooldown, see the BL-1271 evidence file.

## Full-file Stryker attempted, abandoned as disproportionate

`deprecate-check.ts` is a large, pre-existing file: `--mutate
'out/tools/deprecate-check.js'` instruments **823 mutants** (vs. 86 for a
small new file), almost all in production code this ticket did not touch.
Three attempts:

1. Two dry-run timeouts at the default ~5 min (host load 6-8/20 cores,
   not extreme — same shared-host contention pattern as BL-1317's pass).
2. A third attempt with `--dryRunTimeoutMinutes 12` got past the dry run,
   but the mutation phase itself then projected **~1.5-2 hours** at 8-9%
   progress after 10+ minutes (750 mutants, almost all pre-existing debt
   unrelated to this ticket's two-function diff). Killed
   (`kill -- -<pgid>`, confirmed the process group was gone) — running a
   two-hour mutation sweep of someone else's debt to verify two five-line
   functions is not a proportionate use of this gate.

Fell back to a **targeted hand-authored mutation sweep** against exactly
the two functions this ticket added/changed
(`fingerprintableTicketText`, `computeTicketFingerprint`), applied to the
compiled `out/tools/deprecate-check.js` (never while a detached suite had
it open — nothing was outstanding at the time), each restored via
`npm run compile` from the unmutated `.ts` source before the next step
(confirmed byte-identical `git diff` after every restore, since `out/` is
gitignored anyway — the check was against the recompiled output, not git).

### Mutant 1 — drop the `ROUTING_STAMP_LINE` replace (keep only `APPENDED_ROUTING_STAMP`)

**Survived** the full existing test suite (unit + property), including
both of BL-1338's own "re-routing" tests. Root cause: every existing test
constructs the "already-stamped" case by calling the append helper
TWICE (`withRoutingStamp`/`stamp` in both the unit and property files),
and a second append onto an already-appended ticket still produces the
`\n\nassigned_to: <role>\n` double-newline shape at the very end of the
string — which `APPENDED_ROUTING_STAMP` alone still matches and strips.
So neither test file's construction of "re-routing" ever exercises what
`promote_and_route_next.sh`'s real `sed` in-place rewrite actually
produces on a ticket that GENUINELY already carries `assigned_to:` as an
ordinary single-newline-separated field — exactly the shape this repo's
own tickets end in (e.g. BL-1271's and BL-1317's own YAML both end
`\nassigned_to: coder\n`, single newline, not appended).

This is a real gap, not a test artifact: `ROUTING_STAMP_LINE` exists
*specifically* for the in-place-sed case, and nothing in the suite
reached that case.

**Fixed**: added
`extension/test/deprecateAdjudication.test.js`'s
"re-routing a GENUINELY pre-existing (single-newline, sed-rewritten)
assigned_to field does not change the fingerprint" — builds a ticket
whose `assigned_to:` line is single-newline-separated (not appended via
the double-newline helper), rewrites it in place with the same regex
`promote_and_route_next.sh`'s `sed` uses, and asserts the fingerprint is
unchanged. Confirmed: fails against the mutant (isolated — the other 19
pre-existing tests stay green), passes against the real code.

### Mutant 2 — drop the `APPENDED_ROUTING_STAMP` replace (keep only `ROUTING_STAMP_LINE`)

**Killed** by the existing suite (2 tests failed: the direct "does not
change the fingerprint" comparison against the un-stamped `HELD_TICKET`,
and the promoted-ticket acceptance-style unit test) — `ROUTING_STAMP_LINE`
alone still strips the VALUE but leaves the extra blank line the append
introduces, which changes the byte length against the un-stamped
baseline. No fix needed; recorded for completeness.

Both mutants restored to the real source before moving on
(`npm run compile`, confirmed 20/20 unit tests and 2/2 property tests
green).

## CRAP

Not re-run in full — architect/cleaner already established the file's
pre-existing debt (`applyAdjudication`, `decisionFromParsed`,
`evaluateStalePremiseSignals`, `countSpecGapBounces`, `walk`, all >6) is
untouched by this ticket's diff (`git diff e89e836998^^ e89e836998`
touches only the `adjudicationRecordPath`/`computeTicketFingerprint`
neighbourhood). Confirmed directly:
`node scripts/crapReport.js src/tools/deprecate-check.ts` shows
`fingerprintableTicketText` and `computeTicketFingerprint` both at
complexity=1, CRAP=1.00 — this ticket's own delta is clean. The 5
pre-existing >6 functions are unrelated debt, not this ticket's to fix.

## DRY

`npx jscpd src/tools/deprecate-check.ts test/deprecateAdjudication.test.js
test/deprecateRoutingStampFingerprint.property.test.js` — 1 clone flagged,
at lines 500-506/721-727 (two directory-walk helpers,
`walk`/`doneWalk`) — pre-existing, nowhere near this ticket's diff.

## Verification (all green)

- `npx vitest run test/deprecateAdjudication.test.js` — 20/20 (was 19/19; +1 new)
- `npm run test:properties -- test/deprecateRoutingStampFingerprint.property.test.js` — 2/2
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication.feature`
  — 5/5
- Full unit suite (`npx vitest run`, no exclusions): identical FAIL list
  to the pre-existing baseline (25 standing reds, all pre-ticketed — see
  BL-1317's evidence file the same day for the full list and tickets).
  Zero new failures.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended test-file diff plus two
pre-existing untracked files this session never created
(`swarmforge/scripts/open_swarm_spy_router.sh`,
`swarmforge/scripts/spy_router_pane_label.sh`) — left untouched.

## Verdict

One real mutation gap found and closed. No other defect in the ticket's
own domain. Forwarding to documenter.

By hardener.
