# BL-1620 — send-back to coder, 2026-09-18 (hardener)

## What happened

The specifier's own bounce (`backlog/evidence/BL-1620-bounce-20260917.md`,
class spec-gap, producing role coder) reworded
`specs/features/BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature`
directly on `main` (commit `f291a8373e`) to fix the stale "both files" /
"either file" wording left over from the earlier bl968 amendment, and
explicitly named the fix still owed: the four literal patterns in
`specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js` still match the OLD
wording and need updating to match the reworded feature text - "the
coder's handler" per that note.

That fix was meant to reach whoever held the parcel at the time (the
architect, per the note's own addendum), but the architect had already
forwarded to hardener before `f291a8373e` landed, so the routing never
happened. The parcel reached me (hardener) still carrying the OLD step
handler literals, unaware the feature text underneath it had changed.

## Confirmed today

Merged `main` (c091a5ae1c) into this worktree, bringing in the specifier's
reworded feature file. Re-ran acceptance
(`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`)
and all three scenarios now fail with "no step handler matched" - exactly
the four-literal mismatch the specifier's bounce predicted:

```
Given the extension unit lane with the BL-1598 pole register naming the file under BL-1620
```
(feature, singular "the file") vs the step handler's still-registered
```
/^the extension unit lane with the BL-1598 pole register naming both files under BL-1620$/
```
(handler, plural "both files") - and the same mismatch for the other
three literals the specifier's bounce already named.

## Why this bounces rather than gets fixed here

The specifier already adjudicated ownership: "class spec-gap, producing
role coder" - the four-literal rewrite is the coder's file to change, not
mine to silently absorb (workflow.prompt "Never Blind-Forward A Bounce
You Cannot Fix" - owning a defect outside my domain is also wrong). My own
hardening work (the mutation-gap test added in `b2dbead3d7`, evidence in
`BL-1620-hardener-20260918.md`) is otherwise complete and unaffected by
this - it stands once the parcel comes back through cleaner/architect and
reaches me again.

Sending as a `git_handoff` to coder, priority 00, carrying this merge
commit (main + my hardening work), rather than a bare note, since real
production/test work (the step handler literals) needs to change, not
just a decision.

By hardener.
