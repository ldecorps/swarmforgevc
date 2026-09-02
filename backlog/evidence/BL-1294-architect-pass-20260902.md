# BL-1294 — architect pass — 20260902

**Merged:** cleaner `d73300c192` (`bfcc3b1e6f` coder tip) into architect at
`ccd7d3c0c1`.

## Verdict: PASS — forward to hardender. Review inventory: NONE (in-parcel).

## Scope

`extension/test/helpers/pinnedRepoFixture.js`,
`extension/test/pinnedRepoFixture.test.js`,
`extension/test/bl1294FixtureClosurePathAndFailureInvariants.property.test.js`,
`specs/pipeline/steps/bl1294FixtureScriptClosurePreservesDependencyPathsSteps.js`,
`specs/pipeline/steps/index.js` (+bl1294 registration only). All test
infrastructure — no `extension/src/**` or `media/**` touched, so no
extension-host/webview boundary, secrets, or webview-storage rule is in
play for this parcel.

## Dependency gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against the parcel's five
changed files reported ONE forbidden edge:

    ../specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js
      -> ../specs/pipeline/steps/index.js violates "acyclic"

Verified this is **not introduced by this parcel** before treating it as
anything but standing debt:

- `git show 66a3e2abcf:specs/pipeline/steps/index.js` (the commit
  immediately before any BL-1294 work) already contains
  `require('./bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps')` at line
  503 — this parcel added one unrelated line (the bl1294 registration),
  touching neither side of the flagged edge.
- The reverse edge is a `require('./index')` **inside a function body**
  (`runBl718ScenarioByName`, line 40 of the bl726… file) — a lazy,
  deferred require used to call back into the step registry for a
  meta-acceptance check of BL-718's own wiring, not a load-time cycle.
  Node's CommonJS handles this fine at runtime (both modules are already
  in the require cache by the time the function runs); dependency-cruiser's
  static edge analysis can't see the eager/lazy distinction, so it flags it
  regardless.
- Confirmed no other step-handler file does this (`grep -rl
  "require('\./index')" specs/pipeline/steps/*.js` → 1 hit, the pre-existing
  one). Not a pattern this parcel added to or touched.

Grepped before reporting (per architect.prompt's "ANY failure OUTSIDE your
parcel is already ticketed until proven otherwise"): `grep -rl
"bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps"` and broader
acyclic/cycle/steps-index searches across `backlog/{paused,active,hold,evidence}/`
found no ticket for this specific edge (BL-601's "acyclic-rework" and BL-759's
cycle are both different files, both already resolved). Reporting it as
genuinely untracked via a `note` to the specifier (priority `00`), not a
bounce of this parcel — per architect.prompt's explicit rule that an edge
the parcel did not introduce is a report, not a bounce.

**No other forbidden edges** (no-io-from-policy, view-not-import-host-io,
no-process-spawn-from-view, core-not-vscode-api, no-webview-storage) —
expected, since no `src/**`/`media/**` file is in this parcel.

## Co-change (BL-255, informational)

`node extension/out/tools/co-change-report.js` on the five changed files:
all "SUSPECTED COUPLING" flags land on the pinnedRepoFixture module family
itself (its own test/property files, the 11 documented callers of
`copyLiveScriptClosureInto`, and BL-1038's original ticket artifacts) — the
expected, legitimate coupling for a shared test-helper module and its
consumers. No hidden/unlinked coupling found requiring action.

## Invariants review (BL-633/654)

Both declared invariants have a property test in the new
`bl1294FixtureClosurePathAndFailureInvariants.property.test.js`, authored
by the coder (not by me, per architect.prompt). Confirmed non-vacuous by
inspection and by re-running: P1 (unresolvable dependency fails naming it)
and P2 (dependency location survives the copy, never flattened) both drive
`copyScriptClosure` over a real scratch filesystem, both assert
`sawNested >= 8` of 30 runs (generator reach, BL-654), and both would fail
against the pre-fix shapes the coder's evidence describes (the old
`continue` for P1, a basename-only resolver for P2 — the latter already
closed by BL-1240, confirmed present in the code, see "Not this parcel's
work" below). Ran both tests myself: 2/2 green.

Swept the parcel for other sites violating either invariant: only one
call site (`copyScriptClosure`) implements the copy; no second code path
exists that could independently violate either property.

## Not this parcel's work — invariant 2's path-preservation half predates it

Per the coder's own evidence, `loadFileDeps`/`resolveDepPath`/
`resolveScriptClosure` (the path-structure-preserving half of the ticket's
two named defects) were already fixed on `main` by BL-1240's own rework
before this parcel started — confirmed by diffing `66a3e2abcf` (the base
commit) against the coder's tip: the only functional change in
`pinnedRepoFixture.js` is the `continue` → `throw` in `copyScriptClosure`.
Matches the ticket's own `ruling_options` (BL-1240 unblocked itself another
way) and the coder's stated scope check.

## Verification (re-run independently)

| check | result |
|---|---|
| `telegramFrontDeskBotCli.property.test.js` (original incident, BL-1203 inv 1) | 3/3 green |
| `bl1294FixtureClosurePathAndFailureInvariants.property.test.js` | 2/2 green |
| `pinnedRepoFixture.test.js` | 16/16 green |
| `telegramFrontDeskBotCli.test.js` | 271/271 green |
| `grep bl1294 specs/pipeline/steps/index.js` (required_wiring anchor) | 1 hit |
| `node specs/pipeline/cli.js specs/features/BL-1294-….feature` | 4/4 scenarios pass |

## Property-testing pass (architect-owned, undeclared properties)

Parcel touches only the already-covered `pinnedRepoFixture.js` mechanism;
both properties a reasonable reviewer would want (fail-loud, path-fidelity)
are exactly the two declared invariants the coder already encoded. No
further pure/testable module in scope needs new property coverage.

## Handoff

- `git_handoff` to hardender, priority `00`, task
  `BL-1294-fixture-script-closure-preserves-dependency-paths`, commit
  `ccd7d3c0c1`.
- `note` to specifier, priority `00`: pre-existing `acyclic` edge
  `bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js` ↔
  `specs/pipeline/steps/index.js` (lazy require), untracked per grep,
  surfaced for ticketing — not blocking this parcel.

By architect.
