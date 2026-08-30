# BL-1210 hardener pass — 2026-08-30

## Scope
Ticket's diff touches `readSwarmIconId`/`recordSwarmIconId` in
`extension/src/concierge/blTopicStore.ts` and the generalized
`readIconMap`/`recordIconInMap`/`isStorableTopicId`/`readUnboundSwarmIconId`/
`recordUnboundSwarmIconId`/`reportMarkerRefusedToStderr` in
`extension/src/concierge/topicThreadKind.ts`.

## Unit hardening (added this pass)
Four tests added to `extension/test/topicThreadKind.test.js`:
- malformed (array) icon store recovers to an empty map, not the array, and a
  write on top of it survives (drives the fallback through a write, since a
  read-only assertion can't discriminate `[]['x']` from `{}['x']`).
- malformed (primitive) icon store also recovers to an empty map (the
  `typeof parsed === 'object'` half of the same guard).
- `isStorableTopicId` refuses a non-string id, not just a blank one.
- `reportMarkerRefusedToStderr` asserts its own BL-1210 wording, distinct from
  BL-695's `reportUnboundThreadToStderr` line.

## Stryker mutation (scoped, one file at a time, `--force`)
- `topicThreadKind.js`: 93/97 mutants, 4 Survived. All 4 read at lines outside
  this ticket's diff (`migrateOneSupervisorRecord`'s regex/read/undefined-check
  at 149-151, pre-existing BL-695 code) **except** one:
  - `topicThreadKind.js:91` `StringLiteral 'utf8'->''` inside `readIconMap`
    (this ticket's generalized function). **EQUIVALENT**: `fs.readFileSync(file,
    '')` returns a `Buffer`, and `JSON.parse` coerces its argument via
    `ToString`, which for a `Buffer` calls `Buffer.prototype.toString()` —
    defaulting to `utf8`. Verified live (`node -e`) that
    `JSON.parse(fs.readFileSync(f,'utf8'))` and `JSON.parse(fs.readFileSync(f,''))`
    produce byte-identical results, including a multi-byte (non-ASCII) value.
    No assertion could ever differentiate the two at this call site.
- `blTopicStore.js`: 112/126 mutants, 14 Survived. All 14 are on functions this
  ticket's diff never touched: `hasUpdateId` (69), `hasCompletionRecord` (85),
  `readRecord`'s JSON.parse/guard (124/130/131 — same equivalent-encoding
  mutant as above), `commitTopicRecord` (165),
  `reportCommitFailureToStderr` (173-174), `maybeReportUnbound` (224 — still
  called from the untouched `appendMessage`, confirmed live via grep), and the
  pre-existing `if (!committed) { reportCommitFailure(...) }` tail inside
  `recordSwarmIconId` (252 — byte-identical to the pre-ticket version; only the
  trailing `return 'recorded';` this ticket added follows it). None of these
  are new or changed by this ticket — grandfathered debt, out of scope.

Net: zero real, in-scope survivors. One equivalent mutant recorded above
(BL-234 exception, demonstrable from the code).

## CRAP (`src/*.ts`, per Engineering Rules scoping)
All functions in both files at or under CRAP 6 (max 5.00,
`recordSwarmIconId`/`readIconMap`/`swarmIconIdFromRecord`). No regression.

## DRY
`jscpd` flags one 8-line/50-token clone between `appendMessage`'s and
`recordSwarmIconId`'s write-atomicWrite-commit tails in `blTopicStore.ts`.
Confirmed pre-existing: the identical clone (7 lines/49 tokens, just under this
pass's default threshold) is present in the pre-ticket file
(`f376eba7f~1`) at a lower `--min-lines`/`--min-tokens`. This ticket's own
`return 'recorded';` line only nudged an already-existing duplication over the
default threshold — not a new duplication, not this ticket's to fix
(cleaner-domain, structure-preserving cleanup).

## Suites
- `npx vitest run test/topicThreadKind.test.js test/blTopicStore.test.js`:
  76/76 passing.
- Full `extension` suite: 24 pre-existing failing files (bridgeServer,
  epicMakeTopBridge, epicReorderBridge, pausedPagerBridge, topicMakeTopBridge,
  several `landPilotedTicket`/pilot-gate checks, etc.), none touching
  `blTopicStore`/`topicThreadKind`/`concierge`. Per BL-1063 ("A red OUTSIDE
  your parcel is already ticketed until you have grepped and proved
  otherwise"): out of this parcel's scope, not chased down here.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1210-...feature` — 5/5 passing (fresh `npm run compile`
  run first, per the stale-`out/` trap).
- Gherkin mutation manifest already embedded in the feature file (prior
  session, `tested_at: 2026-08-30T06:56:38Z`): 8/8 killed, 0 survived.

## Cleanup
Deleted the scratch `extension/stryker.bl1210.config.json` and
`extension/vitest.stryker-bl1210.config.mjs` (their own header comments said
"Deleted after this run") and the `tmp/bl1210-stryker-*.log` detached-run logs.
Confirmed no orphaned `node --test`/`stryker` processes before starting
(`pgrep -fl`) and none left running after.

`swarmforge/scripts/wait_pipeline_drain.sh` (untracked) is unrelated to this
ticket — already surfaced and pending a human decision under BL-1286's
approval_context (coordinator/specifier exchange, 2026-08-30). Left untouched.

By hardener.
