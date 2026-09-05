# BL-1434 — hardener pass, 2026-09-05

Ticket: BL-1434-the-host-activity-feed-property-registers-its-trials
Commit reviewed: 898edf33c7 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npm run compile` | clean |
| `npx vitest run --config vitest.properties.config.mjs test/hostActivityFeed.property.test.js` | 1/1 pass |
| same, with `BL1434_INJECT_INVENTED_LINE=1` | fails, naming `invented line INVENTED-L0-45-429` — reproduced independently myself, matching all three prior roles exactly |
| `npx vitest run --config vitest.properties.config.mjs test/bl1175PropertySuiteStandingRedsInvariants.property.test.js` | 3/3 pass |
| `node specs/pipeline/cli.js specs/features/BL-1434-...feature` | 4/4 pass |
| `grep -c hostActivityFeed backlog/standing-reds.tsv swarmforge/scripts/property_suite_standing_allowlist.tsv` | 0/0 |
| `cat swarmforge/scripts/property_suite_standing_allowlist.tsv` | header row only |
| `git diff --stat 898edf33c7~3 898edf33c7 -- extension/src` | empty (invariant 3) |
| `grep -n __setHostActivityAppendHookForTests extension/src/bridge/hostActivityFeed.ts` | confirmed a real, pre-existing export (not fabricated) |
| `npx jscpd` on the 3 touched/new files, correct invocation (positional paths + `--pattern "**/*.{ts,js}"`) | 1 clone, confined entirely within `bl1175PropertySuiteStandingRedsInvariants.property.test.js` |
| **Full `npm run test:properties`** | **362/362 files, 1081/1081 tests pass, exit 0** — 2 "Unhandled Errors" are the known-benign BL-871 `[vitest-worker]: Timeout calling "onTaskUpdate"` (the only allowlisted `test:properties` unhandled error per Engineering Rules), not a regression |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently confirmed the jscpd clone is pre-existing (not re-trusted)

Extracted `bl1175PropertySuiteStandingRedsInvariants.property.test.js`'s
content from the commit immediately before this ticket's own diff
(`ca0dabe1a7^`) and ran jscpd on that extracted copy alone: same 9-line /
117-token clone shape, only shifted by this ticket's own insertion — the
clone pre-dates BL-1434's diff entirely, independently confirming the
cleaner's and architect's own claim rather than re-trusting their run.

## Full suite regression: better than the cleaner's own run, not worse

The cleaner's evidence noted 1080/1081 with one unrelated flake
(`bl1367ApprovalCarriesItsRuling.property.test.js`, clean alone) — a
known load-dependent flake class this repo has hit before. My own
independent full-suite run came back fully clean: **1081/1081**, no
failures at all, confirming the earlier flake was exactly that (load
noise, not a regression this parcel introduces) rather than something
this pass needed to chase further.

## BL-113 gherkin mutation: not applicable

`grep -c "Scenario Outline" specs/features/BL-1434-...feature` → 0. All
four scenarios are plain `Scenario:` blocks with no Examples table — no
mutation target for the tool. This ticket's own change is a test-file
conversion (bare script → registered vitest test) plus two register-row
removals; the conversion's correctness is already proven by a real
hand-authored mutant (the injected-invented-line seam, reproduced
independently above), which is exactly the non-vacuity discipline BL-113
would otherwise supply. No further hand-authored sweep is warranted — the
ticket introduces no new production logic (invariant 3, independently
confirmed: `extension/src` untouched).

## Design/CRAP/DRY

No production code changed. jscpd (correctly invoked) confirms the one
residual clone predates this ticket's diff. Babashka not involved; this
ticket is entirely TypeScript-test/JS-step-handler/data-register.

## Verdict

No defect. The out-of-parcel finding the architect flagged during BL-1206
review is genuinely and completely closed. Forwarding to documenter.
