# BL-1066 — hardener pass

Merged architect's clean review (`d95439c144`, on top of coder `649c4e5f1` and
cleaner `ea95bb5de4`) into the hardener worktree, recompiled `extension/out/`,
then hardened.

## Mutation cooldown gate (BL-149), read fresh

| File | Decision | Age vs `main` |
|---|---|---|
| `extension/src/metrics/metricsTickGate.ts` | run | new file, no `main` baseline (epoch age) |
| `extension/src/panel/swarmPanel.ts` | run | 38.18 days |
| `extension/src/metrics/swarmMetrics.ts` | **skip-cooldown** | 0.58 days — touched on `main` ~14h ago by BL-1011, unrelated ticket |

Host quiet throughout (load 0.96–1.88 on 20 cores, well under the 2x-cores
busy threshold).

## Blocking pre-existing defect found and fixed: Stryker mutation was broken repo-wide

Before any BL-1066-specific mutation could run, `stryker run --mutate
out/metrics/metricsTickGate.js` failed its DRY RUN (which always executes the
full unit suite regardless of scope) on
`bl968StepRegistryMaterializedTreeGuard.test.js` — unrelated to this parcel.
Root cause: that test's helper (`extension/test/helpers/materializedRegistryGuard.js`)
computes its own "repo root" via `path.join(__dirname, '..', '..', '..')`.
Under a normal checkout this lands on the real repo root; under Stryker's
mutation sandbox (which copies `extension/` itself into
`.stryker-tmp/sandbox-<id>/` and runs tests from there — the sandbox root IS
the extension checkout, not a child of one) the same parent-count instead
lands one level too shallow, on `.stryker-tmp/` — which carries only the
sibling symlinks for `specs/`/`swarmforge/`/`docs/`/`pwa/`/`.github/`
(`ensureStrykerSandboxSiblings.js`), never an `extension` entry. The helper's
symlink loop then silently skips creating the `extension` symlink at all
(`existsSync` false, no throw), so the materialized test tree has no
`extension/out/...` at all, and a step handler's load-time require of a
compiled module fails — misreporting as an invariant-1 violation.

Fixed by resolving the extension root independently of directory depth
(`findExtensionRoot`: walk up from `__dirname` to the nearest `package.json`
named `swarmforge-vc`), used for the `extension`/`node_modules` symlink
targets; `REPO_ROOT` (for `specs/pipeline`) is unchanged and still resolves
correctly via the existing sibling-symlink mechanism. Re-verified both BL-968
guard tests (unit + property) green after the fix.

Getting past that surfaced a SECOND, same-class defect:
`bl643NonPipelineAgentsStepsGuards.test.js` computes its own `SCRIPTS_DIR` the
same parent-counting way to install an `fs.readdirSync`/`fs.existsSync` mock
keyed on `dir === SCRIPTS_DIR` / `p === BABYSITTER_LAUNCHER`. Under the
sandbox this resolves through the `.stryker-tmp/swarmforge` symlink, while the
step-handler module under test (`specs/pipeline/steps/bl643NonPipelineAgentsSteps.js`,
loaded via the real, non-sandboxed `specs/` symlink) computes the SAME real
directory via a different string — so the `===` check silently never matched
and the mock never fired ("Missing expected exception"). Fixed by wrapping
the test's `SCRIPTS_DIR` in `fs.realpathSync()`, collapsing both routes to
the same canonical path. Re-verified 7/7 green standalone.

Sent a `rule_proposal` (priority 50, scope `role:hardender`) to the specifier
capturing this as a general lesson before proceeding — full text and both
incidents in the proposal body.

Neither fix touches this ticket's own scope (`metricsTickGate.ts`,
`swarmMetrics.ts`, `swarmPanel.ts`); both are test-infrastructure repairs in
my own domain, made because they were blocking my mutation gate (per
"Never Blind-Forward A Bounce You Cannot Fix" and the BL-788-class precedent
of fixing a harness hazard found mid-pass, noted here rather than bounced).

## Stryker mutation — `metricsTickGate.ts` (the new, wholly-owned module)

First real run: 33 mutants covered, 32 killed, **1 survived**:

```
[Survived] ConditionalExpression
out/metrics/metricsTickGate.js:24:45 (source line 47)
-  return subject === latestSubject && lastCompletedAtMs !== null && options.now() - lastCompletedAtMs < options.minIntervalMs;
+  return subject === latestSubject && true && options.now() - lastCompletedAtMs < options.minIntervalMs;
```

Real gap, not equivalent: `null` coerces to `0` in subtraction, so
`options.now() - lastCompletedAtMs` with the guard removed only differs from
intent when a caller's `now()` starts near zero rather than a real
`Date.now()` epoch (always far larger than any sane `minIntervalMs`) — the
panel's own usage (`now: () => Date.now()`) never observably distinguishes
the two, but the gate's own interface takes an arbitrary injectable clock
(that's the whole point of the module, and the property test's own generator
already starts its fake clock at `nowMs = 0`), so a fresh-clock caller is a
real, foreseeable case the guard exists for.

Added `metricsTickGate.test.js`: "the first run computes even when the clock
starts at zero (below the refresh interval)". Non-vacuity proven by hand:
copied the source, applied the exact mutant, recompiled, reran — exactly this
one new test failed (`'throttled' !== 'ran'`), all 9 others stayed green;
restored the original source and reconfirmed 10/10 green.

Re-ran Stryker with `--force` (source unchanged, only a test added — the
stale-cache trap applies) scoped to the same file:
**`metricsTickGate.js`: 33/33 killed, 0 survived, 100% mutation score.**

## Stryker — `swarmPanel.ts`: not run, and why

The cooldown gate says `run`, but this parcel's own diff there is an import,
one new private field initializer (a call expression, no branch), and a
one-line function-call swap inside `postMetrics` (`computeSwarmMetrics(...)`
→ `computeSwarmMetricsOnTick(this.meanTicketTimeGate, ...)`) — confirmed by
listing every added non-comment line in the diff; zero new conditionals.
`SwarmPanel` is the VS Code Extension API / webview-host boundary
(`engineering.prompt`'s Design And Testability: "environmentally unsuitable"
modules do not participate in mutation/CRAP/DRY tooling) — every method on
the class is 0%-covered by construction (confirmed: no test in
`extension/test/` instantiates `SwarmPanel` or calls `postMetrics`/`poll`
directly), pre-existing and unrelated to this diff. A full-file Stryker run
against ~2000+ mutants there would only re-surface that already-accepted
structural exemption, not new signal from this parcel's zero-branch diff, so
it was skipped. The touched call site's actual behavior (the gate's `run()`
called with `this.targetPath` as subject) is proven instead by
`metricsTickGate`'s own tests/property tests plus the architect's own
regression-test-backed confirmation that re-pointing `updateTarget` mid-flight
cannot serve a stale cross-repo mean.

## CRAP (`src/*.ts`, per BL-381 — never `out/*.js`)

`node scripts/crapReport.js src/metrics/metricsTickGate.ts
src/metrics/swarmMetrics.ts src/panel/swarmPanel.ts`:

- `metricsTickGate.ts`: 3/3 functions at 100% coverage, CRAP 1.00 each.
- `swarmPanel.ts`: several pre-existing 0%-coverage functions flagged (up to
  CRAP 380 on an anonymous callback) — all pre-existing VS Code-host debt,
  confirmed via the differential-complexity check below to be UNCHANGED by
  this diff (no function's complexity rose vs. `main`'s baseline). Not this
  parcel's regression.
- `swarmMetrics.ts`: **skip-cooldown** this pass (BL-149; touched on `main`
  ~14h ago by an unrelated ticket) — mutation and CRAP enforcement deferred
  per the cooldown gate's "only files the gate reports run for reach the
  steps below." One marginal flag noted anyway since it is real, NEW code
  from this exact parcel (not incidental churn): `activationTimeMs`,
  complexity=6, coverage=95%, CRAP=6.0045 (rounds to display as 6.00,
  technically >6). Confirmed via `git show main:...` that `activationTimeMs`/
  `indexArrivals`/`ticketDurationMs` do not exist on `main` at all — wholly
  new to this ticket, not pre-existing debt. Given the marginal size and that
  full mutation is deliberately deferred here, left as-is rather than forcing
  an extra test purely to nudge a coverage percentage on a file this pass is
  not otherwise touching; flagging in case the specifier wants a fast-follow
  once the file's churn settles.

Differential complexity check (`main` vs. parcel): read every added
non-comment line in `swarmPanel.ts`'s diff by hand — zero new
branches/conditionals in any changed function (`poll`, `postMetrics`). No
complexity regression.

## DRY

`npm run dry` (jscpd): 34 clones, all in `telegram*` files this parcel does
not touch — identical count/location to the coder's and architect's own
runs. No new duplication.

## Verification, re-run live

- `npm run compile`: clean.
- `npx vitest run` (full unit suite): **469 files / 8293 tests, ALL PASS**
  (8293 = the architect's 8292 + this pass's one new test).
- `npx vitest run` scoped to the 13 `*Guard*.test.js` standing whole-tree
  guards (this parcel touches `extension/test/`): **125/125 PASS**.
- `npm run test:properties` (full lane): 145/146 files, 425/426 tests. The
  one failure, `bl796NvmNodePathFollowUpAdoptInvariants`, is the
  already-triaged, already-ticketed BL-1063 flake (backgrounded-child race;
  cross-checked against `backlog/evidence/BL-1061-property-lane-triage-20260822.md`'s
  mechanism table) — unrelated to this parcel. The other previously-noted
  flake (BL-1062, unseeded generator-reach floor) did not reproduce this run,
  consistent with its own intermittent nature. Both `Unhandled Error` entries
  are the known-benign `[vitest-worker]: Timeout calling "onTaskUpdate"`
  artifact (BL-871).
- BL-113 Gherkin soft mutation on the one `Scenario Outline` (`<done-tickets>`
  10/800): **2/2 killed, 0 survived, 0 errors** — genuine step-handler
  rejections naming each mutated value, manifest embedded in-file.
- `specs/pipeline/scripts/run_acceptance.sh` on the feature: **5/5**.
- `required_wiring` (`bl1066MetricsTickSteps` in
  `specs/pipeline/steps/index.js`): confirmed present (unchanged from
  architect's pass).

## Orphaned processes / leaked fixtures

Checked before, during (via `pgrep`), and after every run — clean throughout,
nothing left running. `git status --short` clean except the four files this
pass intentionally changed (three test files, the feature file's embedded
BL-113 manifest); no leaked tmp fixtures.

## Verdict

Mutation-hardened. `metricsTickGate.ts` at 100% mutation score (1 real
survivor found and killed with a new test, non-vacuity hand-proven).
`swarmPanel.ts`'s diff carries zero new complexity and lives entirely in the
untestable host boundary — correctly out of scope for Stryker. `swarmMetrics.ts`
correctly deferred under the BL-149 cooldown gate, with its one new
marginal-CRAP function flagged for visibility, not blocked on. Two
pre-existing, previously-undiscovered Stryker-sandbox defects found and fixed
along the way (blocking the mutation gate project-wide since BL-968 landed),
captured as a `rule_proposal` to the specifier. Forwarding to documenter.

— By hardender.
