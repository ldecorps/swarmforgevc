# BL-1618 / BL-1619 / BL-1620 — specifier adjudication of the human's "test lanes run for hours" intake, 2026-09-17

Inbound: coordinator `note` 009046 (07:12Z) "op: human intake filed
4128c7e4a0 - test lanes run for hours, drain root". Intake:
`backlog/INTAKE-test-lanes-run-for-hours-changed-path-selection-20260917.md`
(commit 4128c7e4a0, the operator filing the human's words of 07:10Z),
archived with its disposition to `backlog/archive/`. Drained 07:30Z-07:50Z.

## The human's words (verbatim, the binding text)

"There is a golden rule in the swarm which states that the unit tests
should not have timers or sleeps so that it can run super fast. When then
today a considerable amount of time is spent waiting for tests to run? Its
becoming a thing in itself. What happened to make the swarm knowingly run
tests for hours? Is there a ticket to revisit the unit tests so that they
can run quickly? I suppose each role has to be more careful about each
tests to run. Specifier is speccing small tickets. Architect has to ensure
that the dependencies are such that changing a small area of the code does
not mean running hours long test suites."

## What is measured (this checkout, not the intake's summary)

- Unit lane: `extension/.test-durations.jsonl` last row 2026-09-16T17:16Z -
  1029 files, pass, 35.8 s wall, work 273.6 s, pole 34.3 s. The lane the
  golden rule is about is fine.
- Property lane: one full `npm run test:properties` = 319.94 s wall, 408
  files (QA evidence 2026-09-16); `vitest.properties.config.mjs` include
  `test/**/*.property.test.js`, `testTimeout: 20000`; no recorder, no row.
- Acceptance: `run_acceptance.sh <feature-file>` is per feature (1286
  features exist; nobody runs them all per parcel).
- Who is told to run what: coder.prompt and cleaner.prompt "Run unit tests
  and relevant local verification"; architect.prompt runs the property lane
  when it touches properties; documenter.prompt nothing; QA.prompt alone
  has a Verification Order (full unit, Article 4.5 changed-path, property
  lane, acceptance). Every role ran everything by habit, not by rule.
- The multiplier: six roles x (36 s unit + 320 s property + acceptance) +
  Stryker at the hardender, at cap 5-6 on one 20-core host - about 32 min
  of property lane alone per parcel, and under that load the flat 20 s
  timeout fired reds that became BL-1588, BL-1596, BL-1607, each verified
  by re-running the slow file (BL-1607: 20 times, ~8 min).
- The master checkout's `.test-durations.jsonl` recorded 3 unit runs on
  2026-09-16: each role's runs land in its own worktree's copy, so the
  master file undercounts by design - the intake's per-role count comes
  from watching panes and is consistent with the evidence trail.

## Decisions

1. **Prose now, mechanism next.** The five role prompts gained an interim
   "What you run before forwarding" block this commit: coder - unit once,
   property once, own acceptance; cleaner/architect/documenter - compile,
   unit only when they touched extension/, mapped test per changed path,
   own acceptance, no property lane, no Stryker; hardender - unit,
   mutation, bb runners, own acceptance, no property lane. QA unchanged.
   The human asked for mechanisms, not discipline: **BL-1618** puts the
   lane table in one script with a `--plan` mode, so the prompts shrink to
   "run the command" when it lands (the specifier lands that prose at
   activation, BL-798).
2. **The one ambiguity goes to the human as a ruling** (BL-1618): "Coder
   keeps the full unit lane but not the property lane on every iteration"
   reads as once-before-forward or never. A: coder once + QA once
   (recommended: a property regression found only at QA costs a four-hop
   bounce for 5 min saved); B: QA only. `ruling_options`/`ruling_tradeoffs`
   declared per BL-1300/BL-1531.
3. **Measure the property lane before ratcheting it** - **BL-1619** is
   the recorder half only (row, verdict, census), the shape BL-791 slice A
   took for the unit lane; register + ratchet is slice E, minted from the
   census. Splitting keeps both INVEST-independent.
4. **Slice D minted as a first cut** - **BL-1620**: the two 65-70 s files
   (half the poles' work); their `suite-poles.tsv` rows re-owned this
   commit (the register's own rule). The other seven and the watch file
   stay on the epic, cut one or two at a time. Priority below the
   multiplier tickets: the unit lane is 36 s; poles matter to the per-file
   gate, not to the hours.
5. **The specifier rule**: a `qa_e2e_procedure` never says "run it N times"
   for N above 3 - landed in specifier.prompt this commit.
6. **One epic, widened**, not a new one: BL-791 retitled, its "Out of
   scope" amended (property lane and the per-parcel multiplier in; the
   per-feature acceptance run still out), slices D-G recorded, the three
   tickets added to `decomposes_into`. The human framed it as one problem.
7. **No question to the human beyond the ruling.** The intake delegated the
   shape ("Whether this is one new epic or slices on BL-791 is the
   specifier's call") and fixed the priority ("the human's").

## Not done, on purpose

- No `required_wiring` production anchor on BL-1618: its consumers are the
  prompts (main-landed, parcel anchors would false-block, BL-798) and a
  self-declaration anchor gates nothing (BL-1235); said in the ticket.
- The bb runner lanes (190 property + 201 shell runners, no timing): slice
  G, only if they become a lane outside the hardender.
- BL-1596 (bare per-test timeouts) stays as is; BL-1619 does not touch
  property files.

By specifier.
