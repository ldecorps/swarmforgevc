# BL-1032 hardener pass — 2026-08-22

**Parcel:** architect-forwarded commit `f3207b74e4` ("architect pass on the
live-line port — compliant, forwarding to hardener"), merged into
`swarmforge-hardender` cleanly (no conflicts).

## Tooling scope

Neither Stryker (`stryker.config.json`'s `mutate: ["out/**/*.js"]`, compiled
TS under `extension/out/` only) nor CRAP/DRY (`crapReport.js`/jscpd, both
scoped to `extension/src/**/*.ts` via `npm run coverage`) reach
`specs/pipeline/steps/lib/tmuxReaperGuard.js` or
`specs/pipeline/steps/bl1032TmuxReaperScopeSteps.js` — plain JS outside
`extension/src`. No production file in this parcel is `extension/src/*.ts`,
so CRAP/DRY have nothing to run against. Per engineering.prompt's fallback
for untooled surfaces: hand-authored surgical mutation sweep over the
production logic, plus BL-113 Gherkin acceptance mutation for the feature's
`Scenario Outline`.

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    bash specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature \
      tmp/bl1032-gherkin-mutation \
      specs/pipeline/steps/index.js \
      soft

Result: `outcome: pass`, 2/2 killed (both `Examples:` rows of scenario
tmux-reaper-scope-02 — `by spawning tmux directly` / `through a tmux stub it
puts on PATH`). Manifest embedded in the feature file, `tested_at`
2026-08-22T13:09:57Z. No survivors, no errors.

## Hand-authored mutation sweep — `tmuxReaperGuard.js`

Six single-edit mutants tried against the pre-hardening test tree (unit +
property lanes). Two survived — real gaps, both now closed by tests added
in this pass; four were already killed by the existing suite.

| # | Mutant | Result (pre-fix) | Closed by |
|---|--------|-------------------|-----------|
| A | Drop `start-server` alternative from `CREATES_A_SERVER` (`/['"](?:new-session\|start-server)['"]/` → `/['"](?:new-session)['"]/`) | **SURVIVED** — 12/12 unit + 2/2 property still passed; `start-server` was never exercised by any fixture | New unit tests: `"start-server" is a server-creating subcommand`, `spawning tmux without naming a server-creating subcommand is not in scope` |
| B | Swap `SPAWNS_TMUX` route-1 gate to unconditional `return true` after `CREATES_A_SERVER` | killed (breaks the data-only / asserts-about-argv case, both unit and property) | pre-existing |
| C | Drop `PREPENDS_TO_PATH` conjunct from route 2 (`WRITES_TMUX_ON_PATH.test(text) && PREPENDS_TO_PATH.test(text)` → `WRITES_TMUX_ON_PATH.test(text)`) | **SURVIVED** — every existing fixture (unit and the property generator's `stubber` kind) always carries a PATH-prepend alongside the tmux-on-disk write, so nothing isolated this half of the conjunction | New unit test: `writing a tmux stub without ever putting it on PATH is not in scope`; new property generator kind `stubber-unreachable` (hazard-free, writes the stub, never prepends PATH) folded into both invariant tests |
| D | `REQUIRES_FIXTURE_REAPER && CALLS_TRACK` → `\|\|` | killed (existing unit test: require-without-track) | pre-existing |
| E | `\btrack\s*\(` → `\btrack\(` (drop optional whitespace) | not chased — no fixture in the corpus writes `track (` with a space; below this ticket's `mutation_cost: low` bar and outside the two hazard shapes the ticket's own invariants name | recorded, not fixed |
| F | Widen `WRITES_TMUX_ON_PATH` to match `chmodSync` alone with no `writeFileSync` requirement in the same statement | not chased — regex is already an OR over the two calls by design; isolating them further is not part of either declared invariant | recorded, not fixed |

Each surviving mutant (A, C) was re-verified killed after the fix, restoring
the source file to its original (byte-identical, `git diff` empty) between
every mutant trial — never mutating in place while any suite might still be
reading it.

## Verification after the fix

- `npx vitest run test/tmuxReaperGuard.test.js` — **15/15 pass** (was 12,
  +3 new: the two hardening cases above split into 3 assertions).
- `npm run test:properties -- bl1032TmuxReaperScope.property.test.js` —
  **2/2 pass**, both invariants, now covering 5 generated kinds (added
  `stubber-unreachable`) with floors ≥40 each and `withReaper` ≥100 over
  300 runs.
- `node specs/pipeline/cli.js specs/features/BL-1032-....feature` —
  **4/4 pass** (unmutated, post-fix confirmation).
- Full default unit lane (`npx vitest run` from `extension/`): **8220/8221
  pass**. The one failure —
  `test/tempDirTrapGuard.test.js` on
  `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb` — is
  the standing, pre-existing BL-1033 defect named in this ticket's own
  `notes:` and re-verified here: its last-touching commit `71ee902a2` is an
  ancestor of both `main` and `origin/main` (`git rev-list --left-right
  --count main...origin/main` → `33 0`, local ahead only). Not this parcel's
  defect; out of scope per the ticket's own "Out of scope" section.

## No orphaned processes

`ps -ef | grep -E 'vitest|stryker'` clean after every run in this pass; the
`pgrep -f 'node --test|stryker|vitest'` hits during the pass were
self-matches against the Bash tool's own wrapper argv (the pattern string
itself), not real processes — confirmed via `ps -ef`.

## Verdict

Hardened. Two real mutation-uncovered gaps in the hazard-scoping logic
closed (an untested `CREATES_A_SERVER` alternative, and an untested half of
the route-2 conjunction); everything else already load-bearing. Forwarding
to documenter.

By hardender.
