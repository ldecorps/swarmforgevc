# BL-1003 QA bounce — 2026-08-20

## Complete inventory (Article 4.4)

- Full extension unit suite (`npm test`): run once under heavy live-swarm
  host load, 7 failed files / 14 failed tests. Every failure individually
  re-run in isolation to separate signal from noise (per the standing
  lesson: re-run the whole file, not just the named failure).
- BL-1003's own scope: acceptance feature 12/12 PASS, targeted unit tests
  (`agentPaneState.test.js`, `tmuxClient.test.js`) 89/89 PASS (after a
  stale `out/` compile on my first pass — recompiled, re-ran clean),
  property test (`bl1003BusyVerdictParity.property.test.js`) 1/1 PASS.
  These are all GREEN and not part of this bounce.
- Of the 7 failed files, 6 are NOT this ticket's defect (documented below
  for completeness, per Article 4.4's "record BLOCKED BY / clean sweep"
  discipline — not bounced):
  - `test/mermaidRender.test.js`, `test/renderBriefingBurndownCli.test.js`,
    `test/renderBriefingDiagramsCli.test.js`,
    `test/briefingDigestLineCli.test.js`: re-run in isolation, all
    failures are `Error: Test timed out in 20000ms/45000ms` — pure
    timeouts on real-repo-derivation/subprocess/PNG-render paths that
    touch zero lines BL-1003 changed. Consistent with the extreme host
    load observed all session (files elsewhere in this same run took up
    to 30x their normal budget). Environmental, not a regression.
  - `test/bl643NonPipelineAgentsStepsGuards.test.js`: re-run in isolation,
    fails with "found launch_*.sh script(s) with no known agent-name
    mapping: launch_operator_runtime_supervisor.sh" — that file is
    BL-993's (still `backlog/active/`, in flight), confirmed present
    BYTE-IDENTICAL before BL-1003's own merge (`git show 315c89412:...`
    succeeds). Pre-existing, unrelated to this ticket; surfaced by note,
    not folded into this bounce.

## D1 — `paneTailer.ts`'s `roleActivityStatus` regresses for real, undamaged pane text (class: unit, blamed: coder)

**Failing command** (from `extension/`):
`npx vitest run test/paneTailer.test.js`

**Commit tested**: `4befa2317` (documenter's BL-1003 commit `c377b4fc24`
merged into QA)

**First error excerpt**:
```
FAIL  test/paneTailer.test.js > an active-work command/pane text makes a role working regardless of recency
AssertionError: Expected values to be strictly equal:

false !== true

 ❯ test/paneTailer.test.js:317:10
    315|   });
    316|   const decision = decideRoleActivity(status, ACTIVITY_NOW);
    317|   assert.equal(decision.working, true);
```
Reproduced twice, deterministically, in full isolation (not load-related —
the file has 64 tests, 63 pass, this one fails every time).

**Failure class**: `unit`

**Expected vs observed**: Expected `decideRoleActivity` to report
`working: true` for `rawText: 'Thinking… (esc to interrupt)'` (a real
Claude-Code mid-turn footer shape, per the test's own comment); observed
`working: false`.

**Root cause**: `extension/src/panel/paneTailer.ts:93` calls
`isAgentActivelyWorking(status.command, status.rawText)` from
`agentPaneState.ts` — one of BL-1003's own named two direct callers of
`isPaneActivelyProcessing`. The ticket's scope note ("isPaneActivelyProcessing
has exactly two callers... both are fixed by changing that one function")
is accurate as far as it goes, but did not extend the audit one level
further to `isAgentActivelyWorking`'s OWN callers — `paneTailer.ts`'s
`roleActivityStatus`/`decideRoleActivity`, which feeds the extension's
live role-activity/tile state. That caller's own pre-existing regression
test (`paneTailer.test.js:307-318`, untouched by this parcel) encodes the
OLD lexical contract (any occurrence of "esc to interrupt" anywhere) and
is not updated for the new structural one (spinner-glyph-led frame line,
required by BL-970's definition this ticket ports).

This is not a case of the new definition being wrong — BL-1003's own
fixtures show real Claude Code panes DO carry the spinner glyph, and the
port is a byte-identical match to `chase_sweep_lib.bb`'s reference
pattern (verified independently by QA before this run). The gap is that
`paneTailer.ts`'s real caller and its existing regression coverage were
not part of this parcel's own verification, despite the ticket's own
`qa_e2e_procedure` step 7 asking for exactly this: "Run the extension
unit suite and confirm no regression in the pane-state and respawn
paths." `paneTailer.ts` IS a pane-state path and was not checked before
handoff.

**Remediation** (direction, not mandate): either (a) confirm
`paneTailer.ts`'s real callers only ever see genuine live-status-frame
text in practice and update `paneTailer.test.js`'s fixture to a realistic
spinner-glyph-prefixed shape (matching the `specs/features/fixtures/BL-970/`
captures), recording why the old fixture was unrepresentative; or (b) if
`roleActivityStatus` genuinely needs to recognize a broader shape than
`isPaneActivelyProcessing`'s structural frame (e.g. it observes different
capture shapes than the respawn precheck), that is a real design question
for the specifier, not something to work around silently in this parcel.
Either way, `paneTailer.test.js` must go green as part of this fix, and
the full extension unit suite must be re-run clean before returning to
QA (not just the two callers the original parcel checked).

## Verdict

Sent back to coder (owns the port; the caller-audit gap and the
resulting untouched-but-broken test are implementation scope, same class
as the two named callers already in this parcel). Do not forward to
cleaner.
