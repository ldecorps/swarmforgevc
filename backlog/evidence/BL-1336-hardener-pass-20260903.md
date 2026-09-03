# BL-1336 hardener pass — 2026-09-03

Merged architect commit `52685d4ba5` (clean sweep, no defect) onto this
worktree as `3b6431f7db` (one trivial additive conflict in
`specs/pipeline/steps/index.js`, same shape as this session's two earlier
merges — resolved keeping both requires, confirmed by loading the
registry).

## required_wiring re-verified
`swarmforge.sh::SWARMFORGE_ROTATION` — confirmed exported beside the
existing `SWARMFORGE_PACK` export; `zsh -n swarmforge/scripts/swarmforge.sh`
clean.

## Re-run independently
- `npm run compile` — clean.
- `npx vitest run bl1336RouterForkCeiling.test.js bridgeServer.test.js
  vitestWorkerMemoryBudget.test.js` — 138/138.
- `npx vitest run --config vitest.properties.config.mjs
  bl1336ForkCeilingInvariants bl1323StampOffInvariants vitestForkCeiling`
  — run 3 consecutive times, 13/13 each time.
- `node specs/pipeline/cli.js
  specs/features/BL-1336-router-rotation-raises-the-vitest-fork-ceiling.feature`
  — 6/6.

## CRAP / DRY
Only one `.ts` source file in the ticket's own diff
(`src/tools/vitest-worker-memory-budget.ts`; verified by isolating the
coder's own commit `49fca1c741`'s stat from the merge noise, same
discipline the architect's evidence used). Coverage regenerated
(`vitest run --coverage --coverage.reportOnFailure=true`, detached; same
15 unrelated pre-existing reds as this session's other two passes, no
overlap with this file):
`node scripts/crapReport.js src/tools/vitest-worker-memory-budget.ts` —
every function <= CRAP 5, 100% coverage, nothing flagged.
`npx jscpd --config .jscpd.json src/tools/vitest-worker-memory-budget.ts`
— 0 clones.

## Mutation
Scoped Stryker (temp `tmp/stryker.bl1336.config.json` +
`tmp/vitest.bl1336.config.mjs`, deleted after — same pattern as this
session's BL-1350 pass, avoiding the pre-existing
`liveRepoDerivationGuard` standing red that blocks the repo-wide dry
run), detached: `out/tools/vitest-worker-memory-budget.js` 97.62%,
41 killed / 1 survived.

The one survivor, line 78 (`if (raw === undefined) return undefined;` in
`parsePositiveIntOverride`, mutated to `if (false)`), is an **equivalent
mutant** (BL-234 shape), confirmed empirically (BL-1081 discipline —
patch-and-diff, not argument):

    node -e "
    function without_guard(raw) {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    }
    console.log(without_guard(undefined));  // undefined
    "

`Number(undefined)` is `NaN`, `Number.isInteger(NaN)` is `false`, so the
ternary returns `undefined` whether or not the early-return guard fires
— the two branches are observationally identical for every caller.
Recorded, not force-tested.

## BL-113 Gherkin soft mutation
One `Scenario Outline:` (the 4-row pack/rotation/platform/ceiling
matrix). Ran fresh (`mktemp -d` work-dir, deleted after): **10/10
killed on the `rotation`/`ceiling` columns, 6/16 survived on `pack`/
`platform`** for the 3 non-full-forge-darwin rows. All 6 are equivalent
mutants, demonstrable from `resolveVitestForkCeiling`'s own code, not
argued from resemblance:

- The ceiling decision is `(pack === FULL_FORGE_PACK && platform ===
  MACOS_PLATFORM) ? 1 : (rotation === ROUTER_ROTATION) ? ROUTER_FORK_
  CEILING : defaultCeiling`.
- Row `full-forge | sequential | linux | the default`: `platform ===
  MACOS_PLATFORM` is false regardless of how `pack` is spelled (`&&`
  with an already-false operand), so mutating `pack` cannot change the
  outcome. Symmetrically, mutating `platform`'s spelling ("linux" ->
  "liNux") cannot change `platform === MACOS_PLATFORM` — neither
  spelling equals `'darwin'`.
- Rows `mono-router | router|sequential | linux | ...`: the router
  branch reads only `rotation`, never `pack` — `pack` is not evaluated
  in this arm at all, so mutating it is a no-op by construction. The
  full-forge branch is also unreachable here since `pack` (mutated or
  not) is never `'full-forge'`. `platform`'s exact spelling is
  irrelevant for the same reason as above.
- Row `full-forge | sequential | darwin | one` (examples[0]) — the ONE
  row where `pack`/`platform` genuinely gate the outcome — had **both**
  mutations killed, confirming the discrimination is real where the
  code actually depends on the value and absent only where it
  provably does not.

This is the textbook already-false-AND-operand equivalence, not a
host-masked case-insensitivity trap (BL-927) — the code never compares
these values against anything except the fixed constants `'full-forge'`/
`'darwin'`/`'router'`, and no filesystem or case-folding is involved.
Manifest stamp reflects this (`scenarios: []`, per BL-502 — a scenario
with any survivor, equivalent or not, is omitted from the clean list).

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/`. Same 3 pre-existing,
already-ticketed failures (BL-1289/1290/1291) as this session's earlier
passes — none naming a file this ticket touches.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean, no
  leftover processes; all temp config/log files deleted after use.

## Verdict
No defect found; one mutation gap closed by demonstrating equivalence
rather than by test (correctly, per BL-234/BL-1081). Forwarding to
documenter.
