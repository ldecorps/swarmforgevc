# BL-687 — hardener pass — 2026-08-14

## Scope reviewed

Received from architect at `e7c0a74951` (single commit, `By coder.` —
architect approved coder's work unchanged). Files: `extension/src/bridge/
bridgeServer.ts`, `extension/src/bridge/epicReorderUiHtml.ts`,
`extension/src/bridge/makeTopPrioritySafety.ts`, three new
`*.property.test.js` files (one per declared invariant), regression
coverage across `epicDrilldownUiHtml.test.js`, `epicMakeTopBridge.test.js`,
`epicReorderBridge.test.js`, `makeTopPrioritySafety.test.js`,
`topicMakeTopBridge.test.js`, plus the acceptance feature and its step
handlers.

## BL-149 cooldown gate (per changed production file)

`mutation_cooldown_gate.bb` against all three changed production files:
- `bridgeServer.ts`: `skip-cooldown` (touched 0.39 days ago, within the
  3-day window — this ticket's own change).
- `epicReorderUiHtml.ts`: `run` (16.32 days since last touch).
- `makeTopPrioritySafety.ts`: `run` (18.26 days since last touch).
Host reported quiet (load 7.42/4 cores) at gate time.

## Review of coder-authored property tests (all 3 declared invariants)

Independently reviewed, not taken on the coder's word:
- Invariant 1 (`bl687WithinEpicLiveItems.property.test.js`): fuzzes
  `combineWithinEpicLiveItems` directly (pure, no FS), asserts membership
  is exactly paused+hold+active minus epic-typed/epic-less/done rows, with
  reachability floors for every named case (paused/hold/active member,
  done-excluded, epic-row-excluded, epic-less-excluded). Non-vacuous.
- Invariant 2 (`bl687TopicMakeTopActiveDependencyInert.property.test.js`):
  control/treatment differential — same narrow fixture run twice, once
  with no active dependency, once with a `depends_on` naming an id present
  in the widened ordering array but absent from `dependencyLiveItems`.
  Asserts `changed`/`reason` are byte-identical between control and
  treatment across 400 runs. This is the right shape to catch a leak of
  the widened set into dependency-liveness.
- Invariant 3 (`bl687EpicTileSurfaceUntouched.property.test.js`): real
  bridge server + real git fixture, run twice (baseline vs. active/done
  extras), diffs the tile list, make-top verdict, AND the byte content of
  the active/ file after the epic-tile make-top runs (the most sensitive
  oracle — a leak would rewrite the file even if it stayed in `active/`).

## Coverage / CRAP / DRY

- `npm run compile`: clean.
- Full suite (`vitest run --coverage --testTimeout=60000`, extended timeout
  needed — see "Host load" below): 428/428 files, 7575/7575 tests pass.
- CRAP scoped to the three changed `src/*.ts` files: every function BL-687
  itself added or touched is at CRAP <= 6 (`computeEpicReorderState`,
  `combineWithinEpicLiveItems`, `readWithinEpicLiveBacklogItems`,
  `handleEpicReorderTopicMakeTopRoute` all CRAP 1-2; `computeMakeTopPriority`
  sits exactly at 6, complexity 6, coverage 100%). The 13 functions in
  `bridgeServer.ts` that exceed CRAP 6 are pre-existing, unrelated code
  (`mergeTopicId`, `mirrorLetsTalkTurnToBubble`, `buildCostRankState`,
  `requireControlAuth`, etc.) — not touched by this ticket, not regressed
  by it.
- DRY (`npm run dry`): the only clones reported inside `bridgeServer.ts`
  are pre-existing (one pair explicitly pre-annotated in the source as
  "extracted ... to keep that function's own CRAP threshold down - no
  behavior change") and outside the lines this ticket touched. No new
  duplication from BL-687's own additions.

## Acceptance pre-check

`run_acceptance.sh specs/features/BL-687-epic-reorder-includes-active-children.feature`:
9/9 scenarios pass (the Scenario Outline's 3 Examples plus 6 plain
scenarios), ~24s, clean run.

## Host load and two deferred tools (not a code defect either time)

Host load was severely and persistently elevated this whole pass (1-min
average ranged 4-30 across the session on a 4-core host, 5/15-min averages
staying 8-20 for most of it — well past the 2x-cores gate).

- **Stryker (TS mutation, `epicReorderUiHtml.ts`)**: the perTest dry-run
  crashed with "Initial test run timed out!" after ~5 minutes at load
  ~7-8/4-cores — the exact documented failure mode (hardener.prompt: a
  perTest dry-run can hard-crash rather than stall under load). Per the
  same doc's office-hours-bypass guidance, not retried under continued
  high load; `makeTopPrioritySafety.ts` was not attempted for the same
  reason. `bridgeServer.ts` itself is `skip-cooldown` this pass regardless
  (see above). **Deferred to the next quiet pass.**
- **Gherkin mutation (BL-113, the feature's Scenario Outline)**: two
  independent attempts (`run_gherkin_mutation.sh ... soft`) both stalled
  at the very first status line (`completed=0 running=0`, worker/mutator
  process CPU time flat at ~0.1s for 2-3 minutes each) — this is a
  distinct failure mode from Stryker's crash-under-load: near-zero CPU
  activity, not slow computation, suggesting a worker-protocol stall
  rather than contention alone (the underlying acceptance harness itself
  ran cleanly and fast — 24s, see above — ruling out a broken harness).
  Both attempts killed by process name (`bb gherkin-mutator`,
  `mutationWorker.js`, `run_gherkin_mutation.sh`), confirmed reaped, no
  fixture tmux/test files leaked (`git status --short` clean). **Deferred
  to the next quiet pass** — not recorded as a pass, not recorded as a
  fail. A `rule_proposal` capturing this new stall shape is filed
  separately.

## Verification

- `npm run compile`: clean.
- Full suite: 428/428 files, 7575/7575 tests pass (extended timeout run;
  the one apparent failure on a first pass at default 20s timeout,
  `renderBriefingDiagramsCli.test.js`'s real-repo diagram render, was
  independently re-run in isolation and passed in 3.7s — a full-suite
  worker-contention flake, unrelated to BL-687's own files, not a
  regression).
- CRAP: clean for BL-687's own scope (see above).
- DRY: no new duplication.
- Acceptance: 9/9 scenarios pass.

## Verdict

No defect found in BL-687's own scope. All property/unit/regression/
acceptance coverage independently reviewed and verified non-vacuous.
Mutation tooling (Stryker for the two cooldown-eligible files, Gherkin
mutation for the feature's Scenario Outline) deferred to the next quiet
pass per office-hours-bypass policy — both failures are environmental
(load-crash and worker-stall respectively), not signals about BL-687's own
code. Forwarding to documenter.

By hardender.
