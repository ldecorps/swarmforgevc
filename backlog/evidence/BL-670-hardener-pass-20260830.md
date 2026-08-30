# BL-670 — hardener pass

Hardener, 2026-08-30. Merged architect's `c7dd5fffa0` (D1 fixed — a
pre-existing BL-464 standing test still asserted `readTicketStageMap`'s
OLD bare-role return shape; coder updated it to the new normalised shape
and swept the whole unit lane for the same class, finding none).

## Mutation cooldown gate (BL-149)

```
extension/src/swarm/swarmState.ts          DECISION: run
swarmforge/scripts/pipeline_stage_cli.bb   DECISION: run
swarmforge/scripts/pipeline_stage_lib.bb   DECISION: run
load_avg: 2.20  cores: 20  busy_threshold: 2.00x (quiet)
```

`.bb` files have no wired mutation tool (Engineering Rules) — gated by
their own unit-test suite only, re-confirmed green below. `swarmState.ts`
eligible and quiet host — proceeded with a hand-authored sweep (Stryker
itself is blocked repo-wide this session by the standing baseline, same
documented class as every prior pass today).

## Re-verified the coder/architect's headline claims (all clean)

- `npm run compile` — clean.
- `npx vitest run test/state.test.js test/bl670TicketStageQualifier.test.js`:
  28/28 + 21/21 (before my own additions, see below).
- `npm run test:properties -- bl670 / bl1048 / bl1188`: 3/3, 1/1, 3/3.
- `bb pipeline_stage_qualifier_test_runner.bb`: ALL PASS.
- `bb pipeline_stage_lib_test_runner.bb`: ALL TESTS PASSED.
- `bash test_pipeline_stage_cli.sh`: ALL CHECKS PASSED.
- `bb bl670_stage_qualifier_property_runner.bb`: ALL PASS, 500/invariant.
- Acceptance: BL-670 9/9, BL-1048 6/6, BL-464 5/5, BL-487 2/2, BL-1188 5/5
  — all match the coder's/architect's recorded numbers exactly.

## Hand-authored mutation sweep — `normaliseTicketStageEntry` and friends

`swarmState.ts` and `swarmForge`'s TS lane get real Stryker in principle,
but the dry run is blocked by the same unrelated standing baseline every
pass today has hit. Hand-mutated the compiled JS, restoring after each,
`npx vitest run test/bl670TicketStageQualifier.test.js test/state.test.js`
as the kill oracle:

- `typeof value === 'string'` negated — KILLED.
- bare-role empty-string ternary flipped — KILLED.
- object-shape stage-truthy guard weakened (`&&` → drop truthy check) —
  KILLED.
- `entry.status ?? LAST_KNOWN` → `entry.status || LAST_KNOWN` —
  **SURVIVED** (no test with a defined-but-falsy `status`, e.g. `''`). This
  operator choice is deliberate per the docstring's contract ("An entry
  with no status is reported as last-known") but nothing pinned it. Fixed:
  added a test asserting `{stage:'QA', status:''}` keeps `status: ''`
  UNCHANGED (this is the actual `??` behavior — `??` only replaces
  null/undefined, not other falsy values) — the test exists specifically to
  catch a `??`→`||` slip, which WOULD replace it. Re-verified KILLED.
- `(byRole[entry.stage] ??= []).push(...)` → plain assignment (drop the
  nullish-init) — KILLED (multi-ticket-per-role ranking test).

## A real (if narrow) observation, not bounced

`normaliseObjectStage`'s `??` fallback only catches `null`/`undefined`
status values, not other falsy ones (`''`). Recorded above with a pinning
test rather than bounced: the only writer of this store is
`pipeline_stage_cli.bb`, which never emits an empty-string status, so this
is defensive-code-only reach with no live production path — same posture
as the architect's own non-blocking observations earlier this session.

## CRAP — one real over-threshold function in NEW code, fixed by extraction

`normaliseTicketStageEntry` (this ticket's own new function) measured
complexity=8, 100% coverage, **CRAP=8.00** — over threshold, and unlike
this session's earlier grandfathered-debt findings, this one IS new code
from this parcel, so it needed fixing, not just recording.

Extracted the two shape branches into `normaliseBareRoleStage` (complexity
2, CRAP 2.00) and `normaliseObjectStage` (complexity 4, CRAP 4.00), leaving
`normaliseTicketStageEntry` itself a 2-branch dispatcher (complexity 4,
CRAP 4.00). Behavior-preserving: all 5 hand-authored mutants above
re-verified KILLED against the extracted structure, and every existing
test (22/22 in `bl670TicketStageQualifier.test.js`, 28/28 in
`state.test.js`) stayed green with no changes needed to the tests
themselves.

Three OTHER over-threshold functions in the same file —
`readHandoffFilesFromInbox` (CRAP 147.00), `findLiveHolder` (CRAP 58.34),
`hasHandoffFiles` (CRAP 6.01) — confirmed via diff against
`ab04342ce~1` (the commit immediately before BL-670's coder work) to be
BYTE-IDENTICAL, untouched by this ticket. Grandfathered debt, not this
parcel's to fix; each has its own pre-existing test coverage in
`test/liveHolder.test.js`, `test/renderedTileBadge.test.js`,
`test/renderedHolderlessAgreement.test.js` (not BL-670 files).

## DRY

`npx jscpd src/swarm/swarmState.ts --min-lines 10`: 0 clones.

## Whole-tree standing guards (parcel touches `extension/test/` and
`specs/pipeline/steps/`)

Ran all 17 non-property `test/*Guard*.test.js`. 3 failed —
`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`, `tempDirTrapGuard`
— the same confirmed pre-existing standing-red set named in every prior
hardener pass this session. None names `bl670` or either changed source
file.

## Full re-verification

Full `npx vitest run`: 26 failed / 218 failed, 553/579 files passed (up
from 552/578 pre-pass — the 1 new test passes) — identical failure count
to the standing baseline. No regression.

## Orphan process check

Every `node --test|stryker|vitest` process checked by `/proc/<pid>/cwd`;
none rooted in this hardener worktree survived past this pass.

## Verdict

Hardened. One real CRAP gap in new code found and fixed by extraction
(behavior-preserving, all mutants and tests re-verified); one real
mutation gap found and closed (the `??`/`||` fallback pin); one narrow
defensive-reach observation recorded, not bounced. Forwarding to
documenter.
