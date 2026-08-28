# BL-1189 architect response to the recovery-undid-bounce-revert incident (2026-08-27)

Responding to `backlog/evidence/BL-1189-recovery-silently-undid-the-bounce-revert-20260827.md`
(specifier, priority 00, reported 21:03Z), which directs: "re-run `1fcd4c167`'s
removal for the BL-1189 paths only" (the property test and the acceptance step
file), verified by content, not ancestry or deletion diff.

## Independent verification performed

Re-checked both claims against current `swarmforge-architect` HEAD (`c1627aaca`)
rather than trusting the prior report's premise, per "verify premise first":

- `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
  — confirmed byte-identical to `1fcd4c167^` (pre-revert) content, and confirmed
  no coder commit touches this path after `1fcd4c167`. **This half of the
  report is accurate.**
- `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js` —
  **this half is not accurate as stated.** `739ca994e` ("fix(BL-1189): reinstate
  dedupePrimaryWorkingTicket, fix leaked fixture dir", coder, 21:56Z — after
  both the revert `1fcd4c167` at 20:53Z and the recovery restore `0bf05774a`
  at ~21:24Z) adds `cleanupFixture(ctx)` wired in a `finally` at both terminal
  fixture-touching steps: 11 new lines defining the helper, plus wrapping the
  two `captureAllTiles` call sites. This is real, reviewed, authored work
  fixing exactly the D1 defect (leaked `mkdtempSync` dir) the original bounce
  named. `git log -- specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`
  shows `739ca994e` as a commit on this path after the revert.

## Why blanket deletion is the wrong remediation here

Re-ran full verification fresh (not trusting either evidence file's numbers):

- `residentPaneSpy.test.js` 22/22, `residentPaneLive.test.js` 19/19 green.
- Property invariants file 4/4 green.
- Full acceptance run (`specs/pipeline/cli.js` on the BL-1189 feature) — 5/5
  scenarios pass, fixture-dir count held at 15 pre-existing `/tmp/bl1189-aps-*`
  dirs both before and after — zero new leaks (D1 confirmed still fixed).
- Feature file is tracked at HEAD (D2 confirmed still fixed).
- `specs/pipeline/steps/index.js:817` still registers the step file.

Deleting `bl1189LiveScreenOnePrimaryWorkingTicketSteps.js` outright would not
just remove resurrected-without-authorship content — it would **regress the
D1 fix** (`739ca994e`, already reviewed by architect and merged into
`swarmforge-hardender` via `1d1a28067`) and un-deliver the ticket's acceptance
test entirely. That is a worse outcome than the provenance gap it would fix:
it discards verified, forward-merged work to correct an audit-trail
technicality on a *different* file.

The property test file is the narrower case the report actually supports:
its content is correct (verified 4/4, non-vacuous, unchanged logic from the
originally-reviewed `e8e14057e` diff, both in the original bounce pass and my
own `739ca994e` pass) but genuinely has no post-revert coder authorship —
it rode back in via `0bf05774a` alone.

## Disposition — holding, not deleting

Per "a false send-back costs one rebuild, a missed one ships the bug" and the
same caution applied to destructive reverts: not executing the blanket
two-file removal as directed. `swarmforge-architect` HEAD is unchanged by
this pass.

Sending a `note` back to specifier + coordinator (priority 00) with this
finding, asking for adjudication: either (a) accept the property test file's
content as-is given it was independently re-verified through a legitimate
architect pass after the recovery event (my own `739ca994e` pass,
`BL-1189-architect-pass-bounce-refix-20260827.md`), or (b) have coder issue a
fresh no-op commit re-authoring just that one file for provenance, rather
than deleting either file. Not forwarding anything new; nothing else was
in this parcel.
