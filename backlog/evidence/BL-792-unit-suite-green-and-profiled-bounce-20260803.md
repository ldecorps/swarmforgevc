# BL-792-unit-suite-green-and-profiled — hardener bounce evidence (2026-08-03)

Reviewed commit: `644feadbd0` (hardener worktree, after merging QA's BL-766
merge-up `2f507d3c` + architect's BL-792 handoff `3fffd946a5` + a reconciling
`main` merge to pick up files the coder/cleaner/architect lineage never
merged).

## Context: why `main` had to be merged first

`backlog/active/BL-792-unit-suite-green-and-profiled.yaml` and its acceptance
feature `specs/features/BL-792-unit-suite-green-and-profiled.feature` were
created on `main` (58f432e4, 07:57) and promoted to active (32d2d42b, 11:00)
on 2026-08-03. Neither commit was ever an ancestor of the coder's `3015d77b`
("BL-792: make the unit suite green and publish its duration profile",
12:14) — the coder/cleaner/architect lineage's last `main` merge
(`36e3ee44`) predates both. The coder implemented against the ticket's prose
(via handoff note text) without ever having the promoted ticket file or its
Gherkin scenarios in its own tree. That gap is why D1 below exists.

## D1 — acceptance: BL-792's feature file has zero step handlers wired

- **class**: acceptance
- **blamed role**: coder
- **remediation pointer**: `specs/features/BL-792-unit-suite-green-and-profiled.feature`
  (5 scenarios: `unit-suite-green-and-profiled-01` through `-05`). No file
  under `specs/pipeline/steps/` matches any of this feature's step text
  (confirmed via `grep -rl "duration record is read\|per-file duration
  report\|worker was terminated during the run\|test files accounting for
  the bulk"` across `specs/pipeline/steps/` — zero hits).
- **evidence**: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-792-unit-suite-green-and-profiled.feature` — all 5
  scenarios fail identically:
  `no step handler matched "Given the extension unit suite has been run on
  an otherwise-idle host"` (and similarly for the other Given/When/Then
  lines). `1..5 / pass 0 / fail 5`.
- **why coder, not spec-gap**: the scenarios are well-formed and testable
  (they read a duration record and a per-file report — both real, already
  produced artifacts: `extension/.test-durations.jsonl` and
  `docs/reference/BL-792-test-duration-profile.md`). This is missing
  implementation wiring, not an unencodable requirement — per the
  Acceptance Pipeline article, step handlers drive testable modules and are
  part of implementing the ticket, and per the "acceptance pre-check" rule
  this pass must not forward a parcel whose acceptance cannot execute for
  want of step handlers.
- **fix shape** (for the coder, not prescribing implementation): wire
  `specs/pipeline/steps/*.js` handlers for the 5 scenarios, reading
  `extension/.test-durations.jsonl`'s last record for -01/-02/-04 and
  `docs/reference/BL-792-test-duration-profile.md` (or the underlying
  `DurationProfile`/`buildDurationProfile` output) for -03/-05, then re-run
  `run_acceptance.sh` to confirm green before forwarding.

## Full review checklist — run or blocked, nothing skipped

| Check | Result |
| --- | --- |
| Acceptance pre-check | **FAILED** — see D1 above |
| Unit suite (`npm test`, extension/) | **RUN, GREEN** — 401/401 test files, 7075/7075 tests passed, no worker-termination message. `.test-durations.jsonl`'s `result` field and `docs/reference/BL-792-test-duration-profile.md` accurately reflect this run (316.3s/440 files recorded earlier; my own run measured 189.8s/401 files under contended host load — both green, the wall-clock difference tracks host load, not a regression). |
| DRY (`npm run dry`) | **RUN** — 0.61% duplicated lines / 0.87% duplicated tokens project-wide; zero clones involve any BL-792-touched file (`build-test-duration-profile.ts`, `pathContainment.ts`, `vitest-worker-memory-budget.ts`, `co-change-report.ts`, `profile-mutation-workers.ts`, `relay-onboarding-negotiation-telegram.ts`, `telegramCursorBridgePilot.ts`). |
| Mutation (Stryker, differential, changed files) | **BLOCKED BY host load.** `mutation_cooldown_gate.bb` (run with `SWARMFORGE_MUTATION_GATE_FORCE_CORES=4` — see tooling defect below) reports `skip-busy` for all 7 changed production files; `uptime` load average sat between 8.1–12.2 on 4 cores (>2x) for most of this pass, driven by other resident swarm processes sharing this host (confirmed via `ps aux`: a live `bb swarm_handoff.bb`, `start-bridge-headless.js`, `telegram-front-desk-bot.js`, another resident `claude` agent). Per the office-hours/busy-host bypass policy, deferred to the next quiet pass — not weakened, not skipped. |
| CRAP (`npm run crap`) | **BLOCKED BY the same load signal** — `npm run crap` is itself a full coverage run (equivalent weight to the unit suite), and load stayed elevated (5-min/15-min averages 8.1–12.2) through the pass. Deferred alongside mutation. |
| Property tests (`npm run test:properties`) | **RUN — pre-existing failure unrelated to this ticket, not a BL-792 regression.** `test/bl760DuplicateChainGuard.property.test.js` (BL-760, `2e97da84`) timed out on 3 of its properties (`Test timed out in 20000ms`), reproduced in an isolated re-run. Confirmed **not** a BL-792 regression: `git diff 2f507d3c..3fffd946a5 -- extension/test/bl760DuplicateChainGuard.property.test.js` is empty (file untouched), and `vitest.properties.config.mjs` does not use `vitest-worker-memory-budget.ts`'s pool sizing at all (separate, unrelated config — confirmed by reading the file). The fixture spawns real `bb swarm_handoff.bb` subprocesses; under this host's current shared contention a hardcoded 20s test timeout is plausible to miss independent of any code change here. Recording for visibility, not bouncing on it. |

## Environment defect found incidentally (not part of BL-792, not bounced with it)

`swarmforge/scripts/mutation_cooldown_gate.bb`'s `real-core-count` calls
`(process/sh "nproc")` and only falls back to `sysctl -n hw.ncpu` by checking
`(:exit nproc)` — but `process/sh` on a missing binary throws a
`java.io.IOException` rather than returning a non-zero-exit map, so the
fallback branch is dead code on any host without `nproc` (this macOS host).
Worked around this pass via `SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`. Sending
a separate `rule_proposal` (scope `role:hardender`) rather than folding into
this bounce — it is a pre-existing swarmforge script defect, not something
BL-792's diff touched or any of its pipeline stages are blamed for.

## Disposition

One defect (D1) blocks acceptance verification; blamed role is coder
(earliest stage in this lineage). Bouncing to coder with this evidence.
Mutation/CRAP remain to be completed on the next quiet-host pass once D1 is
fixed and the parcel returns.
