# BL-1210 — architect pass, 2026-08-30

Reviewed the cleaner-forwarded commit `8e539579b5` (coder `f376eba7f`,
cleaner merge with no additional cleanup).

## Verdict: COMPLIANT — forwarded to hardender

## Stale-build false alarm, corrected before trusting any test result

The vitest suite (`blTopicStore.test.js`, both backfill CLI test files,
`topicIconSync.test.js`) initially showed 14 failures — every one of them
exactly the new/changed assertions this ticket adds. `extension/out/` was
stale (compiled 05:32, source touched 07:50). `npm run compile`, then a
clean re-run: 239/239 pass. Recorded so it isn't mistaken for a defect by a
later reader of this evidence trail.

## Boundary and correctness read

Read all three touched source files directly, not just the evidence file's
summary:

- `topicThreadKind.ts`: the supervisor store's read/write pair is correctly
  generalised (`readIconMap`/`recordIconInMap`, parameterised by filename)
  rather than duplicated; `SUPERVISOR_ICON_STORE` keeps its BL-695 filename
  unchanged (migration compat), `UNBOUND_ICON_STORE` is new and shared by
  epic/standing/role. `isStorableTopicId` is the one narrow addition to
  `classifyTopicThread`'s surface, and `classifyTopicThread` itself is
  byte-unchanged (confirmed via diff) — the constraint against widening
  `TICKET_ID` holds.
- `blTopicStore.ts`: confirmed `maybeReportUnbound`/`reportUnboundThreadToStderr`
  (BL-695's original tracked-record refusal reporter) is still used, but only
  by `appendMessage` — a genuinely separate concern (tracked-record writes)
  from the new icon-marker path, which now uses `reportMarkerRefusedToStderr`
  instead. No dead code, no conflation of the two refusal classes the ticket
  distinguishes.
- `topicIconSync.ts`: `IconSyncOutcome` gained `'icon-set-marker-unrecorded'`
  as an added union member, not a replacement. Checked every consumer of
  `syncTopicIcon`'s return value: `conciergeTick.ts`'s four call sites all
  discard the return value (already best-effort by design, unaffected);
  the three backfill CLIs (`backfill-epic-topic-icons.ts`,
  `backfill-standing-topic-icons.ts`, `backfill-topic-icons.ts`) bucket by
  `outcome === 'updated'` vs. everything else and dump full JSON detail —
  the new outcome value falls cleanly into the existing "not updated"
  bucket with no silent mishandling or exhaustive-switch gap.

## Constraints (all verified, not assumed)

- `TICKET_ID` unwidened, `classifyTopicThread` byte-identical — confirmed
  via diff.
- No icon pool/value logic touched — confirmed via diff (only
  `topicThreadKind.ts`, `blTopicStore.ts`, `topicIconSync.ts` touched;
  `topicIcon.ts`/`epicIcon.ts` untouched).
- No `isNewTopic` call site changed — confirmed via diff of `conciergeTick.ts`
  (only test file changes, no production changes there).
- No assertion relaxed or deleted — the 5 original red assertions are
  unchanged; they pass now because the implementation catches up to them.
- No thrown exception on the live-tick path — `syncTopicIcon` returns a
  value; re-read the call sites, none wrapped in a new try/catch.

## Independent re-runs

- `cd extension && npx vitest run test/backfillEpicTopicIconsCli.test.js
  test/backfillStandingTopicIconsCli.test.js test/backfillTopicIconsCli.test.js
  test/blTopicStore.test.js test/conciergeTick.test.js
  test/topicIconSync.test.js test/topicThreadKind.test.js` → 239/239 pass
  (after compile).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1210IconMarkerStoreInvariants.property.test.js` → 4/4 pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/topicThreadKind.property.test.js` (qa_e2e_procedure step 5's named
  regression file) → 3/3 pass.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1210's feature → 5/5.
- `git status --porcelain backlog/topics/` → clean (qa_e2e_procedure step 6,
  no tracked-record leak).

## Dependency-rule gate (BL-259, hard gate)

Full-repo scan: `cd extension && node out/tools/dependency-gate.js` →
`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

All flagged co-changes are pre-existing coupling within the same
concierge/front-desk topic-management cluster (BL-695's own commit touched
most of the same files together) — no new or unexpected coupling from this
parcel.

## Pre-existing reds (not this parcel's)

Confirmed the coder's claim: the wider `npx vitest run` red count on this
branch (187 `CURSOR_API_KEY` env-leak failures, 26 repo-hygiene/pilot-module
failures) is unrelated — none of the 16 failing files import
`blTopicStore`, `topicIconSync`, or `topicThreadKind`. Not swept, not this
ticket's to fix.
