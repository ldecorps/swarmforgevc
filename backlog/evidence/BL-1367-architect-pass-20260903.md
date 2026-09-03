# BL-1367 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`1a4544eff9`), merged cleanly (no conflicts) into this
worktree. This closes the exact gap this session's own memory has been
tracking all day (a phone/pager approval flipping `human_approval` while
discarding the ruling) — read the classifier and its two call sites
directly rather than trusting the green suites alone.

## Dependency gate / co-change

`cd extension && node out/tools/dependency-gate.js
src/concierge/pendingApprovalReply.ts src/bridge/bridgeServer.ts` — PASSED,
no forbidden edges. Co-change: both files carry large pre-existing
SUSPECTED COUPLING (shared approval-writer / hub-file), expected and not
new; this parcel's diff to each is a small additive increment reusing
existing helpers (`readRulingOptions`, `rulingHumanApprovalText`), matching
the cleaner's own read.

## Direct read of the mechanism

- `classifyApprovalRulingRequirement` (`pendingApprovalReply.ts:370-390`) is
  pure and total over the four outcomes: no options + no ruling → `ok`; no
  options + a ruling sent anyway → `unknown-option` (a ruling nobody offered
  is refused, not silently written); options + no/blank ruling →
  `ruling-required`; options + an unmatched ruling → `unknown-option`;
  options + a matching ruling → `ok`. Blank is explicitly trimmed and
  treated as absent — a surface can't slip an empty string past the check a
  missing field trips.
- `recordApprovalReply` (`pendingApprovalReply.ts:404-418`) is the ONE
  writer both surfaces now reach — validation is the caller's job, the
  writer does not re-derive or rescue it. Confirmed `computePausedPagerApproveOutcome`
  (`bridgeServer.ts:839-888`) calls the classifier BEFORE ever reaching the
  writer, and refuses with 409 (not 500 — a rule said no, the system is
  healthy) before any file write when `requirement.kind !== 'ok'`.
- Invariant 2 (never overwrite an existing ruling) holds structurally, not
  just by test: `recordApprovalReply` only calls `rulingHumanApprovalText`
  when a ruling argument is actually passed; a plain approval takes
  `approveHumanApprovalText`, which never touches the `human_ruling:` block
  — read both functions, confirmed the block pattern is only replaced inside
  the ruling branch.
- Non-string `ruling` is rejected at the request-shape validator
  (`isPausedPagerApproveRequestShape`, line 740-746) before it ever reaches
  the classifier — a coerced ruling would be a fabricated answer, and this
  closes that path at the boundary.
- The coder's self-audit already checked the two-finder risk
  (`findBacklogFilePath` by filename vs `findTicketFilePath` by `id:`
  field) and confirmed both fail closed rather than disagreeing silently;
  re-read the reasoning and it holds — a filename/id mismatch is refused as
  "not pending approval," never written.

## Invariants (BL-633/654) — all three declared, all three covered

1. Never approved with declared options and no ruling — P1. NON-VACUOUS
   (a bare approval let through for an option-bearing ticket → 1 of 2
   property tests failed).
2. An existing ruling is never overwritten or cleared — P2. NON-VACUOUS
   (clearing on a plain approval → both property tests failed).
3. A no-options ticket approves exactly as before — P3, same breaks.

Generator reach: the accepted case's ruling is drawn FROM the generated
option list (not independently, which would almost never match) — read
the property file, confirmed. All five outcome shapes are asserted as
actually generated.

## Verification run directly

- `npx vitest run test/pendingApprovalReply.test.js
  test/pausedPagerBridge.test.js` — 109/109.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1367ApprovalCarriesItsRuling.property.test.js` — 2/2.
- `npx vitest run test/bridgeServer.test.js test/pendingApprovalFor.test.js
  test/pausedPagerUiHtml.test.js test/telegramFrontDeskBotCore.test.js` —
  561/561, every other consumer of the writer/reader, unchanged.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1367-*.feature` — 4/4, driving the real HTTP route
  (not just the classifier) — the coder's own point that a scenario calling
  only the classifier would report green for a decision that is right and
  never reached, which is this defect's own shape.
- `specs/pipeline/steps/index.js` — `bl1367ApprovalCarriesItsRulingSteps`
  registered; `computePausedPagerApproveOutcome` genuinely reaches the
  classifier (confirmed by reading, not grep alone).

## Property-testing pass (own section, BL-654 scope boundary)

All three declared invariants are the ticket's obligation, covered above.
No other touched pure module needs new coverage.

## Correctness read — a real open question, not a defect in this parcel

The coder's "surfaced, not swept" section is worth this role's own read: the
`/paused-pager/expedite` route (`handlePausedPagerExpediteRoute`) shares
this exact shape — it also calls `recordApprovalReply` with no ruling — but
BL-1083 requires that route to record approval BEFORE gates run, and a
naive copy of this ticket's refusal there would leave Expedite dead (the
over-correction BL-1083's own comment warns against). Read `BL-1083`'s
comment in `bridgeServer.ts` directly: agree this is a genuine policy
conflict (BL-1083's "never blocked" vs BL-1367's "never approved
unanswered") that only the specifier can rule on, not something the coder
or this review should resolve unilaterally. Not a defect in THIS parcel —
`required_wiring` and the ticket's own scope name only the Approve route.

## Verdict

No defect found. Forwarding to hardener. Filing a `note` to the specifier
about the `/paused-pager/expedite` policy conflict (spec-gap, already
surfaced by coder and cleaner — routing it forward rather than letting it
sit only in evidence).
