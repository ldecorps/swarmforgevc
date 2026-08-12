# BL-886 architect review — swarm-stamp vitest orphan-reaper hotfix

**Ticket:** BL-886 — swarm review-stamp-off of the human-landed Cursor
hotfix (`602c7d014c` handoffd_supervisor.bb, `1ecbe049fe` orphan_janitor_lib.bb
/ orphan_janitor_sweep_lib.bb / propertyLaneFixtureRunner.js), both already
ancestors of `main` before this ticket's own pipeline run — this is a
confirm-or-refute pass, not a rewrite (same posture as BL-811/BL-849/BL-879).
**Reviewed commit:** `edaae5f252` (cleaner; a pure merge of coder's
`fc6ead5f0` with no cleaner-authored changes — nothing to clean in a
review-only parcel, confirmed via `git show --stat`, no no-op violation).
**Role:** architect.

## Scope of THIS parcel's diff

`git show fc6ead5f0 --stat` (the coder's actual review pass): 10 files, all
new — test files, the promoted `.feature`, new step handlers/fixture helper,
the evidence file, and two hotfix-ledger entries. **No production `.bb` or
`.js` file under review was modified by this parcel** — matches the coder's
own claim, independently confirmed.

## Hard gate: dependency-rule checker (BL-259)

Only one file in this parcel lives under `extension/`:
`extension/test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js`.
Ran directly: `node out/tools/dependency-gate.js
test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js` (from
`extension/`) → **PASSED: no forbidden edges.** Every other changed file
(`.bb`, `specs/pipeline/steps/*.js`) sits outside the tool's `src`/`media`
scope — NO-OP, not skipped, same posture as BL-879/BL-812.

## Logical coupling (BL-255, co-change-report.js)

Ran against all new/touched files plus the three reviewed `.bb` production
files. The new BL-886 files co-change tightly with each other only (expected
— one commit). `specs/pipeline/steps/index.js` shows a long "SUSPECTED
COUPLING" list, but that file is the shared step-handler registry every
ticket that adds acceptance steps touches — pre-existing, expected noise,
not coupling introduced by this parcel.

## Independent re-verification (ran directly, not trusting the evidence alone)

- `bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
- `bash swarmforge/scripts/test/test_handoffd_supervisor_job_reaper.sh` — ALL PASS (4/4).
- `bb swarmforge/scripts/test/bl886_vitest_orphan_reaper_janitor_property_runner.bb` — ALL PROPERTIES HOLD (300×2).
- `node swarmforge/scripts/test/bl886_vitest_orphan_reaper_supervisor_property_runner.js` — ALL PROPERTIES HOLD (12/12 exhaustive).
- `npx vitest run --config vitest.properties.config.mjs test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js` — 1/1 pass.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-886-...feature` — 11/11 scenarios pass.

All match the coder's claimed results exactly.

## Review goal 5 — `sweep-candidates!` signature (re-verified independently)

`grep -rn "sweep-candidates!" swarmforge/scripts/` surfaces TWO `defn-`
matches, not one — `orphan_agent_reaper_sweep_lib.bb` also defines a
private `sweep-candidates!`. Checked whether this is a real namespace
collision (both files are `load-file`'d together by the janitor property
runner): it is not — `orphan_janitor_sweep_lib.bb` declares
`(ns orphan-janitor-sweep-lib ...)` and `orphan_agent_reaper_sweep_lib.bb`
declares `(ns orphan-agent-reaper-sweep-lib ...)` (line 21), so the two
private fns are namespace-isolated even when loaded into the same process.
Each has exactly one call site within its own file/namespace, and the
janitor's caller (`sweep!`) already passes `project-root` first.
**Confirmed. No defect** (worth having checked directly rather than trusting
the coder's single-file grep — Article 4.4 discipline, not a finding).

## Review goal 6 — wiring

`specs/pipeline/steps/index.js:433` registers `bl886VitestOrphanReaperHotfixSteps`.
Both named runners re-invoked above, independently green. **Confirmed.**

## Invariant 3 — install-once guard

Read `extension/test/helpers/propertyLaneFixtureRunner.js` directly:
module-level `abnormalExitHandlersInstalled` flag, `installAbnormalExitHandlersOnce`
returns early if already set before installing exit/SIGINT/SIGTERM handlers.
**Confirmed**, matches the property test's non-vacuity claim.

## `required_wiring` (both entries re-verified by direct read)

- `orphan_janitor_sweep_lib.bb`'s `sweep-candidates!` still calls
  `orphan-janitor-lib/reapable-hung-vitest?` (line 169). **Present.**
- `handoffd_supervisor.bb`'s `orphaned-job-groups` still calls
  `(job-in-scope? pid cmd)` (line 308). **Present.**

## Architecture rules (two-layer boundary, host-owns-IO, no webview storage, no secrets)

Only one `extension/` file touched, a test file; no webview or extension-host
production code in this parcel. No `localStorage`/`sessionStorage`/secret
patterns present. Trivially compliant — nothing in this parcel's diff
implicates the boundary.

## NAMED REVIEW QUESTION 1 (goal 3) — `job-in-scope?` vs `project-scoped-path?`

**Ruling: real drift, not legitimate independence. Consolidation is due —
opening a follow-up (not bouncing this parcel; see rationale below).**

Traced both predicates directly:

- `handoffd_supervisor.bb`'s `job-in-scope?`: cmd leg `str/includes?`, cwd
  leg `str/starts-with?` (OR'd).
- `orphan_janitor_lib.bb`'s `project-scoped-path?`: BOTH legs
  `str/starts-with?`, via the shared `in-path?` closure.

Checked whether the asymmetry is cosmetic or has a real behavioral
consequence, using the actual invocation shape
(`extension/package.json`'s `test:properties`: `vitest run --config
vitest.properties.config.mjs` — a **relative** config path):

- For the top-level vitest launcher process, `cmd` never contains an
  absolute project path at all (relative config arg) — both predicates
  depend entirely on `cwd` here, no material difference.
- For vitest's own forked worker processes ("(vitest" pattern), `cmd`
  embeds an absolute `node_modules/vitest/...` path **mid-string**, after
  the node binary path — a shape `str/includes?` matches and `str/starts-with?`
  does not. `cwd` would ordinarily also resolve for these (child processes
  inherit cwd), but `process_table_lib.bb`'s `cwd!` is explicitly
  **best-effort** (`lsof`-based fallback on Darwin) and can legitimately
  return `nil` — plausibly exactly when racing a process that is already
  dying, which is the population this reaper exists to catch.
- In that narrow but real intersection (worker cmdline + unresolvable cwd),
  the supervisor's looser cmd leg would still classify the process in-scope;
  the janitor's stricter-on-both check would not, and
  `reapable-hung-vitest?`'s `(not project-scoped?) false` hard-gates the
  reap — the process is never touched.
- This gap is real, not hypothetical: the janitor property runner's own
  generator confirms it was never exercised — `cmdline-shape-pool` (lines
  73-77 of the runner) never embeds any path fragment at all (matching the
  no-path launcher shape only), and `cwd` is drawn from
  `in-scope-cwd-pool`/`out-of-scope-cwd-pool`, both always a defined
  non-nil string. The nil-cwd-plus-worker-cmdline combination was never
  generated, so the coverage gap would not have been caught by this
  parcel's own 300-run property suite.

This does **not** regress anything — before this hotfix, this whole class
went unreaped unconditionally, and the goal-1(a/b/c) guarantees I
independently re-verified above still hold for the common case (cwd
resolves, which is the overwhelming majority of real sweeps). It also isn't
part of this parcel's diff — both predicates are pre-existing production
code that landed on `main` before this ticket's pipeline run, and the
ticket's own framing (review-stamp, not rewrite) plus goal 3's explicit
"decide, record, and open a follow-up if consolidation is due" instruction
route this disposition to a new ticket, not a same-parcel coder fix.
Bouncing this parcel would ask the coder to modify already-shipped
production code under a ticket explicitly scoped as review-only, which the
ticket itself already anticipated and pre-declined via goal 3's phrasing.

**Disposition:** recorded here; a `note` (priority 50, non-blocking) goes to
specifier+coordinator asking for a follow-up ticket: consolidate
`job-in-scope?`/`project-scoped-path?` into one shared helper (natural home:
`process_table_lib.bb`, alongside the already-shared `parent-orphaned?`/`cwd!`
per goal 2's own precedent), using the supervisor's cmd:`includes?` /
cwd:`starts-with?` combination — not the janitor's stricter-on-both version,
which is the one with the demonstrated gap.

## NAMED REVIEW QUESTION 2 (goal 4) — janitor's 2h live-parented stale-reap vs BL-871

**Ruling: the threshold, the fast-path split, and the live-parented leg are
all architecturally sound and complementary to BL-871's pool cap — no
change due, no follow-up needed.**

- BL-871 (read directly: `backlog/active/BL-871-property-lane-worker-pool-cap.yaml`)
  bounds concurrent worker COUNT/heap ceiling within one vitest invocation —
  a host-load/OOM safety net (BL-422 lineage). It says nothing about, and
  cannot detect, a process that has stopped making progress without
  crashing.
- The janitor's live-parented stale-reap targets exactly that different
  failure mode: a genuinely hung (not crashed) property-lane tree whose
  parent is still alive. Complementary, not redundant — matches the
  ticket's own framing and BL-871's own "do not conflate" note.
- The fast-path split (`reapable-hung-vitest?`: `parent-orphaned? → true`
  unconditionally; live-parented → gated on `stale?`) mirrors the
  supervisor's own established asymmetry elsewhere in this same review: a
  dead parent is unconditional evidence of abnormality, a live parent needs
  an independent duration signal since running long is not on its own proof
  of a problem.
- 2.0h (`SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS` default, confirmed by
  direct read) is a generous backstop margin, not a routine trigger — a
  65-file property-lane run should complete in a small fraction of that even
  under BL-871's shrunk (not zero) worker floor on a loaded host.
- This is the exact scoping the ticket's own `approval_context` already
  signals as the right shape (explicitly carving the janitor's live-parented
  leg out of the supervisor's absolute "never touched" guarantee rather than
  silently endorsing or forbidding it).

No action required.

## Invariants review (BL-633/654)

All three declared invariants have property coverage that pre-existed the
coder's first-authorship claim I independently re-ran above (supervisor
exhaustive runner for invariant 1 + supervisor half of invariant 2; janitor
300-run generator for the janitor half of invariant 2; the extension
`fast-check` property for invariant 3). No missing/vacuous obligation.

## Out-of-scope compliance

No BL-871 pool-cap work, no `process_table_lib.bb` changes (only its
existing `parent-orphaned?`/`cwd!` consumed, confirmed by goal 2's trace),
no reaper class widening beyond Stryker/`node --test`/vitest-property-lane,
no BL-885 caffeinate-reclaim folded in. Matches `out_of_scope:`.

## Disposition

Architecturally compliant. Both named review questions resolved with
concrete rulings above — goal 4 needs nothing further; goal 3 is real drift
routed to a follow-up ticket via `note`, not a bounce (rationale above).
Forwarding to hardener.

By architect.
