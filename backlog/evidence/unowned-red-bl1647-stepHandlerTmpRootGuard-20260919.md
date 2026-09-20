# Unowned red found while implementing BL-1652, 2026-09-19

Not BL-1652's own defect - traces to BL-1647's own landed work (already on
`origin/main` at `git show origin/main:specs/pipeline/steps/bl1647ZombiePidfileNotAliveSteps.js`),
not anything this parcel authored.

## test/stepHandlerTmpRootGuard.test.js > "the real handler tree names no
offender outside the committed census"

`specs/pipeline/steps/bl1647ZombiePidfileNotAliveSteps.js` calls raw
`fs.mkdtempSync` (never `trackedTmpRoot`/`onAbnormalExit`/a recognised
sweep helper) and is not in the committed census
(`extension/test/step-handler-tmp-root-census.txt`). `grep -n
stepHandlerTmpRootGuard backlog/standing-reds.tsv` finds no row; BL-1647
(`backlog/active/BL-1647-a-pidfile-naming-a-zombie-is-not-a-live-component.yaml`)
is open but its own row in `backlog/standing-reds.tsv` is for an unrelated
red (`test_finish_shift_lib.sh` case 08 zombie-pid flakiness), not this
guard.

Same spec-gap shape as `backlog/evidence/BL-1636-architect-note-new-offenders-not-in-census-20260919.md`
(BL-1639/BL-875 both landed a raw-mkdtemp step handler in parallel with
BL-1636's own committed census, before either could know about the
other) - BL-1647 was minted/landed the same way, after that note was
written, naming a THIRD instance of the same gap. This session's own new
file (`bl1652ChaseRespawnBusyGuardSteps.js`) used `trackedTmpRoot` from
the start and does not offend.

## Update 2026-09-20: resolved by merge, no owner ticket needed

Merging `main` into this branch (for BL-1652's own forward) picked up
BL-1647's OWN landed hardening pass, which added `onAbnormalExit` to
`bl1647ZombiePidfileNotAliveSteps.js` - `test/stepHandlerTmpRootGuard.test.js`
is green again on this branch post-merge (verified: `npx vitest run
test/stepHandlerTmpRootGuard.test.js` - 4/4 passing). The 09-19 07:21Z notes
to specifier/coordinator predate that merge; no register row or owner
ticket is needed for this instance - left here only as the historical
record of the sighting, not an open red.

By coder.
