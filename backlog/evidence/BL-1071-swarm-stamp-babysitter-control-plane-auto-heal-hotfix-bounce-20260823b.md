# BL-1071 — architect bounce — 20260823 (second bounce, post-QA-refix)

## Context

This parcel reached the architect for a second time: coder → cleaner →
architect, after coder's re-fix of the QA `unit: ps-scope` bounce
(`374bce315`, evidence `BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix-bounce-20260823.md`).
The re-fix itself is sound — reviewed below under "Everything else: PASS".

While the re-fix was in flight, the **specifier** ruled on review goals 3 and
4 mid-ticket (`3dceec963`, `e2cb22fae`, both landed on `main` at 06:10–06:14),
per the "Amending An In-Flight Ticket's Spec" workflow rule (BL-317/BL-325).
Goal 4's ruling is not advisory — it adds **scenario 06** to this ticket's own
`.feature` file and states plainly: "Its step handler must land in THIS
parcel — `specs/pipeline/runtime.js` throws on any scenario with no handler
(BL-233), so the acceptance gate fails until it exists."

The coder's re-fix branch last merged `main` at `2fd3dd100` (06:07:02), which
is **before** both specifier rulings (06:10:17, 06:13:43). Neither the coder
nor the cleaner merged `main` again before forwarding, so the amendment never
reached this parcel. I merged `main` into the architect worktree just now to
review against the current spec, which is what surfaced this.

## D1 — scenario 06 has no step handler (class: behavior / spec-amendment-not-merged)

**Blamed role: coder.**

Reproduced directly:

```
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature
```

```
not ok 10 - an observation that throws is reported unavailable, never silence
  error: 'Scenario "an observation that throws is reported unavailable, never
  silence": no step handler matched "Given the control-plane observation
  throws this sweep"'
# tests 10 / pass 9 / fail 1
```

Scenario 06 (added by `e2cb22fae`, `specs/features/BL-1071-...-hotfix.feature`
lines 65–75) has three steps with no match anywhere in
`specs/pipeline/steps/bl1071BabysitterSweepSurvivalSteps.js`:

- `Given the control-plane observation throws this sweep`
- `Then the reason the observation failed is carried in that finding`
- `And no control-plane recovery is started`

("`Then the control-plane check is reported unavailable`" could reuse
scenario 01/05's UNAVAILABLE-matching shape, but the other two have no analog
in the file at all.)

**The underlying production behavior is already correct** — this is a step-
wiring gap, not a behavior gap. Confirmed by reading the current code, not
assumed:

- `swarmforge/scripts/babysitter_check.bb:1072-1074` — `observe!`'s catch now
  binds the exception and returns `{:classification :unavailable :error ...}`
  (goal 4's fix, already landed in this parcel).
- `swarmforge/scripts/babysitterd_sweep_lib.bb:466-484` — `check-control-plane`
  has a distinct `(= :unavailable control-plane-classification)` branch
  emitting `{:key "control-plane" :severity "UNAVAILABLE" :message (str ...
  (when error) (str ": " control-plane-error))}` — carries the reason, and
  attaches no `:repair` key (the CRIT/`:control-plane-missing` branch is the
  only one that ever adds `:repair {:action :ensure-control-plane}`).
- The property test's own invariant-3 case for `control-plane`
  (`extension/test/bl1071SweepSurvivesAnyProbeFailure.property.test.js:114-149`)
  already exercises this exact probe break and asserts UNAVAILABLE / not-OK /
  not-CRIT.

What the property test does **not** cover, and what scenario 06's third Then
line is for: `ensureCalls(fixture)` is never asserted empty for this probe
break anywhere in the parcel (checked: `ensureCalls` is referenced only in
the plane-response and cooldown steps, never alongside a control-plane-
observation-throws fixture). "No control-plane recovery is started" is a
genuinely new, currently-unverified claim, not a duplicate of existing
coverage.

## Remediation

In `specs/pipeline/steps/bl1071BabysitterSweepSurvivalSteps.js`, add step
definitions for scenario 06's three new lines. The fixture already supports
the state needed — `breakProbes(makeSweepFixture(mkdir), ['control-plane'])`
without `planeMissing: true` — since that already drives `observe!` through
the exact IOException-on-missing-tmux path goal 4 fixed (this is the same
probe break scenario 01's "the control-plane observation" row already uses,
just without asserting the extra two properties scenario 06 wants). Add:

- `Given the control-plane observation throws this sweep` → build that
  fixture.
- `Then the control-plane check is reported unavailable` → can reuse the
  `UNAVAILABLE [control-plane]` match already used elsewhere in this file.
- `And the reason the observation failed is carried in that finding` → assert
  the finding's message contains the actual IOException/error text, not just
  the literal word "unavailable".
- `And no control-plane recovery is started` → `assert.deepEqual(ensureCalls(ctx.fixture), [], ...)`.

## Everything else in this review pass: PASS

- **Dependency gate** (`node extension/out/tools/dependency-gate.js` against
  all BL-1071 changed files): PASSED, no forbidden edges.
- **Co-change report**: the only SUSPECTED COUPLING flags are among
  `babysitter_check.bb` / `babysitterd_sweep_lib.bb` / their test runners /
  `specs/pipeline/steps/index.js` — expected co-evolution of a feature and
  its own test suite, not an undesirable coupling. No action.
- **Invariants 1, 2, 3** all have non-vacuous property tests (break-then-
  restore documented in each file's own header comments, confirmed present
  for all three declared invariants). No invariant violation found.
- **The QA-bounced defect itself** (`strayHangs()` diffing a host-wide
  `pgrep` pattern): correctly re-fixed. `374bce315` scopes the survivor check
  to the sweep's own recorded PGID (`ps -o pgid= -p $$`, read from the child,
  not assumed to be `$$` in the test process), adds an isolation assertion
  (the recovery ran in a group of its own), and a bounded settle window for
  reaping. This is exactly the shape engineering.prompt's Guardrails ask for
  ("redirect through env seams" / scope to the process's own tree, never a
  shared-global diff). Ran in isolation: green (2/2 tests,
  `bl1071RecoveryBoundedInTime.property.test.js`).
- **`required_wiring` anchor**: `bl1071BabysitterSweepSurvivalSteps` is
  registered at `specs/pipeline/steps/index.js:610` — confirmed present.
- Extension-host/webview boundary, browser-storage, secrets-in-host,
  integrate-not-fork: not implicated — this parcel touches only Babashka
  scripts and Node test/step-handler files, no webview or host-I/O code.

This bounce is narrowly for D1 above.
