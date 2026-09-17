# Intake: the swarm knowingly runs tests for hours - the lanes need a per-role scope and the property lane needs a ratchet

Filed by the human via Claude Code (2026-09-17T07:10Z). RAW ask, not a spec:
the specifier drains this like any other backlog-root item and decides what
(if anything) becomes real tickets. The human's own framing: this is
"becoming a thing in itself" - the swarm spends test runs verifying tickets
about test runs.

## The ask

Human, verbatim (2026-09-17, on the QA seat running one guard test 20 times
for BL-1607): "There is a golden rule in the swarm which states that the unit
tests should not have timers or sleeps so that it can run super fast. When
then today a considerable amount of time is spent waiting for tests to run?
Its becoming a thing in itself. What happened to make the swarm knowingly run
tests for hours? Is there a ticket to revisit the unit tests so that they can
run quickly? I suppose each role has to be more careful about each tests to
run. Specifier is speccing small tickets. Architect has to ensure that the
dependencies are such that changing a small area of the code does not mean
running hours long test suites."

## What was observed (measured 2026-09-16/17, this host, 20 cores)

The rule (`engineering-detailed.prompt` "Test Speed And Isolation": no real
timers, keep the unit suite in seconds) is followed to the letter and broken
in spirit. Nothing sleeps; things spawn.

1. **The unit lane itself is now fine.** `extension/.test-durations.jsonl`
   last row: 1029 files, `pass`, 35.8 s wall, work 273.6 s, pole 34.3 s
   (was 169.5 s failing on 2026-08-03). BL-791 slices A/B/C landed
   (BL-792, 1038, 1039, 1598, 1599). Slice D (the remaining poles, per
   file) is listed on the epic and NOT yet minted.

2. **The hours are a multiplier, not a pole.** Per parcel, coder, cleaner,
   architect, hardender, documenter AND QA each run the whole unit lane +
   `npm run test:properties` + the acceptance run; hardender adds a Stryker
   pass (~9 min). Six full-lane runs per parcel, at cap 5-6 tickets on one
   box. Under that load the property lane's flat `testTimeout: 20000`
   fires, a red is minted as a ticket (BL-1588, BL-1596, BL-1607 ...), and
   QA verifies THAT ticket by re-running the slow test N times - BL-1607's
   `qa_e2e_procedure` says 20 times for a 23 s file, ~8 min for one step.

3. **The property lane has no measurement at all.** 414
   `*.property.test.js` files, one `testTimeout` of 20 s, no duration
   recorder, no per-file budget, no ratchet - the unit lane's BL-378 /
   BL-1598 / BL-1599 machinery has no mirror here. Known process-spawning
   shapes: one `bb` process per draw (bl1272, BL-1556), 98 `bb` processes
   per run (bl1297, BL-1564), fixture-spawning files that only miss under
   full-lane load (bl1308/1315/1343/1354, BL-1588). 190 bb property runners
   and 201 bb shell runners under `swarmforge/scripts/test/` likewise carry
   no timing record.

4. **Growth.** 438 unit files (2026-08-03) -> 1029; 407 -> 414 property
   files in two days. The suite roughly 2.5x in six weeks; the lanes
   multiplied (unit, property, acceptance/gherkin, bb shell, bb property,
   Stryker) while every role kept running all of them.

## What is wanted

The human's proposal ("each role more careful about which tests to run;
architect ensures a small change does not mean an hours-long suite") turned
into mechanisms, not discipline:

- **Changed-path test selection for the intermediate roles.** Article 4.5 /
  BL-1164 already forces a mapped unit/wiring test per changed production
  path. Cleaner, architect and documenter run ONLY that mapped set (plus
  compile and the ticket's own acceptance feature); the full unit +
  property + acceptance lanes run exactly once per parcel, at QA. The
  architect's dependency review becomes the thing that keeps the mapped
  set small - that is the "dependencies such that a small change does not
  run hours" ask, as a gate rather than a judgment call. Coder keeps the
  full unit lane (it is 36 s) but not the property lane on every iteration.

- **A duration recorder + ratchet for the property lane**, the mirror of
  BL-378/BL-1598/BL-1599: per-file work recorded from the Vitest JSON
  report, a per-file pole register, a summed-work budget that only
  tightens, a verdict line on every run. Same for the bb runner lanes if
  they are run as a lane anywhere (hardender is the only prompt that names
  them).

- **A specifier rule on `qa_e2e_procedure`:** no "run N times" for N > 3
  unless the procedure names the specific flake it is hunting and the
  ticket is a flake ticket. A slow test is proven slow by one measured run,
  not twenty.

- **BL-791 slice D minted** (the per-file poles the epic already lists),
  and the epic's scope note revisited: it excludes acceptance and says
  nothing about property/bb lanes or the per-parcel multiplier, which is
  where the hours actually are today.

Whether this is one new epic or slices on BL-791 is the specifier's call.
Priority is the human's: this is what the swarm's wall-clock is going on.

## Pointers

- Rule: `swarmforge/constitution/articles/reference/engineering-detailed.prompt`
  "Test Speed And Isolation" (two copies, ~l.105 and ~l.346).
- Epic: `backlog/paused/BL-791-epic-unit-suite-speed.yaml` (`remaining_slices`
  Slice D; "Out of scope" block). Active: BL-1607. Paused: BL-1596.
- Unit-lane recorder/ratchet to mirror: `extension/scripts/recordTestDuration.js`,
  `extension/src/tools/check-suite-duration-budget.ts`, `extension/.test-durations.jsonl`.
- Property lane: `extension/vitest.properties.config.mjs` (`testTimeout: 20000`),
  `npm run test:properties`.
- Per-role lane requirements: `.swarmforge/prompts/QA.md` "Verification Order";
  the equivalent blocks in coder/cleaner/architect/documenter prompts.
- Mapped-test-per-changed-path: Article 4.5 / BL-1164.

---

## Disposition (specifier, 2026-09-17 07:45Z) - drained from the backlog root

Every part of the ask above became one of these; the human's words survive
verbatim above and in each ticket's description (Article 5.3).

| part of the intake | became |
|---|---|
| "Changed-path test selection for the intermediate roles" / "each role has to be more careful about each tests to run" / architect and dependencies | **BL-1618** - one verification command per role holding the lane table (paused, approval pending, with one ruling: coder's property run once or never). Interim prose lane sets landed the same commit in coder, cleaner, architect, hardender and documenter prompts. The mapped-set runner proper is BL-791 slice F. |
| "A duration recorder + ratchet for the property lane" | **BL-1619** - the recorder half (row, verdict, census). Register + ratchet is BL-791 slice E, minted from BL-1619's census. bb runner timing rows: slice G. |
| "A specifier rule on qa_e2e_procedure: no run N times for N > 3" | landed in `swarmforge/roles/specifier.prompt` the same commit. |
| "BL-791 slice D minted, and the epic's scope note revisited" | **BL-1620** - the two largest poles; register rows moved to it. BL-791 retitled and widened (property lane and per-parcel multiplier in scope; slices D-G recorded). |

Specifier evidence, with the multiplier arithmetic and every decision:
`backlog/evidence/BL-1618-specifier-adjudication-of-test-lanes-run-for-hours-intake-20260917.md`.
