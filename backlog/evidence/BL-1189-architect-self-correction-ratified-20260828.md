# Architect re-corrects the previous merge's over-correction — 2026-08-28

## What happened

My previous merge commit (`8c53af882`, "Merge QA-approved 420695b6ca
(BL-592)") removed `dedupePrimaryWorkingTicket` (and its wiring, tests,
step handler, property test) believing it was still-bounced BL-1189
content per BL-1211's description of the `1fcd4c167` revert.

This merge (`b8a11849f8`, "picks up ... BL-1189 hold-lift ruling") carries
`backlog/evidence/BL-1189-specifier-ruling-resurrected-property-test-20260828.md`,
a specifier ruling that **directly corrects my prior action**:

- The property test's presence was **RATIFIED**, not a defect — the
  architect's own bounce (`BL-1189-architect-bounce-20260827.md`) listed
  it under "Passed checks"; it was collateral of a wholesale
  BL-490/BL-495 revert, not something wrong.
- Its siblings from the same origin commit (`e8e14057e`) — both `.ts`
  files and both `.test.js` files — were **deliberately, explicitly
  reinstated** by coder in `739ca994e` ("Reinstated verbatim ... confirmed
  via diff"), and **the architect reviewed and passed that re-fix**.
  `739ca994e` is an ancestor of my own current branch.
- The step handler carries `739ca994e`'s real D1 fix (leaked fixture
  dir) and "must not be removed" — quoting the ruling directly: "My
  earlier direction to re-run `1fcd4c167`'s removal for BOTH BL-1189
  paths was half wrong; the architect verified the premise and correctly
  disputed it" (referring to a different architect instance/pass than the
  one that made my mistake).

So my prior merge's removal was itself the regression, undoing legitimate,
specifier-ratified, architect-passed work — the exact same failure shape
(silently dropping legitimate content) I had correctly been guarding
against all session, just triggered by my own hand this time via an
incomplete read of BL-1211's scope.

## Correction applied, this merge

Restored, from `739ca994e`'s own tree (the coder re-fix commit, an
ancestor of this branch) and from my own prior commit `53171210f` (before
the erroneous removal) for the property test:

- `extension/src/bridge/residentPaneLive.ts`
- `extension/src/concierge/residentPaneSpy.ts`
- `extension/test/residentPaneLive.test.js`
- `extension/test/residentPaneSpy.test.js`
- `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`
- `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
- `specs/pipeline/steps/index.js` — re-added the `bl1189...Steps` require.

## Verification

- `npm run compile` clean, `tsc --noEmit` clean.
- `node out/tools/dependency-gate.js` (full-repo) — PASSED.
- `vitest run test/residentPaneLive.test.js test/residentPaneSpy.test.js`
  — 41/41 PASS (residentPaneLive back to 19 tests, full BL-1189 coverage).
- `vitest run --config vitest.properties.config.mjs bl1189` — 4/4 PASS.
- `node specs/pipeline/cli.js specs/features/BL-1189-live-screen-one-primary-working-ticket.feature`
  — 5/5 scenarios PASS against the real implementation.

## Sending a correction note

My own earlier priority-00 note ("Caveat to my last note: BL-1189 content
is bounced - don't restore, see BL-1211") is now itself wrong and needs a
follow-up correction, since at least one other branch already acted on it
(`90b686434 cleanup(BL-1189): remove resurrected bounced content per
architect caveat/BL-1211` exists in repo history). Sending a further
priority-00 note pointing to the specifier's ruling.

## Lesson

When correcting what looks like your own prior mistake mid-session, the
same discipline applies as correcting anyone else's: verify against the
CURRENT authoritative record (here, a specifier ruling that had not yet
landed when I made the original call), not just re-deriving from first
principles a second time. BL-1211 itself was still `paused` and had not
yet been amended when I acted on it — a paused, unshipped ticket's
`description:` is a proposal being reviewed, not settled doctrine, and
should be read as provisional until ratified.

By architect.
