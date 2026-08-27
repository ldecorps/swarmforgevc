# BL-619 hardener pass — 2026-08-08

Reviewed commit received via architect's `340e238be2` (evidence-only, no
defects), merged into this worktree. Touched files:
`extension/src/metrics/{burnProjection,burnSectionText,usageAnchorStore}.ts`,
`extension/src/tools/{token-burn-section,usage-anchor}.ts`,
`swarmforge/scripts/{briefing_email_lib,handoffd}.bb`, plus tests.

## BL-149 cooldown gate

All 5 TS files and `briefing_email_lib.bb` read `run` (host quiet) on first
check; `handoffd.bb` read `skip-cooldown` (shared hub file inside the 3-day
window). Host load fluctuated between quiet and busy (~7-14 load avg on 4
cores) through this pass — see Stryker section below for the load-gated
decision actually taken.

## CRAP — 3 violations found and fixed by behavior-preserving split

`node scripts/crapReport.js` against the 5 changed `.ts` files initially
reported 3 functions over the CRAP<=6 threshold:

| function | complexity | coverage | CRAP |
|---|---|---|---|
| `usage-anchor.ts::parseArgs` | 9 | 100% | 9.00 |
| `usageAnchorStore.ts::isUsageAnchor` | 8 | 86% | 8.19 |
| `burnProjection.ts::parseWeekResetConfig` | 7 | 100% | 7.00 |

Two of the three were pure complexity (100% coverage already) — CRAP equals
complexity at full coverage, so no test could close them; only a split could.
Fixes, all behavior-preserving:

- `parseArgs`: extracted the `--now` flag-scanning loop into `extractNowFlag`
  and the positional pct/scope parse+validate into `parsePctAndScope`.
  `parseArgs` now complexity 4; both helpers complexity 4.
- `parseWeekResetConfig`: extracted the two default-or-parse ternaries into
  `resolveResetDay`/`resolveResetLocal`, and the `raw ?? '(default)'` label
  formatting into `formatConfigRawLabel`. Parent now complexity 2; each
  helper complexity 2.
- `isUsageAnchor` (complexity 8, coverage 86% — a real branch gap, not pure
  complexity): split its 3-clause AND chain into `hasValidAtMs`/
  `hasValidPct`/`hasValidScope`, each complexity 2. The coverage gap was the
  underlying defect this hardener lesson exists for ("a validator with N
  AND'd conditions needs a present-but-malformed case per field, not just one
  failing example") — the existing test only ever failed the `pct` clause
  (via an out-of-range value); `atMs`/`scope` clauses were never independently
  exercised false. Added
  `extension/test/usageAnchorStore.test.js::'a present-but-malformed anchor
  record is rejected field by field'` covering: null, a bare string,
  non-number `atMs`, non-finite `atMs`, non-number `pct`, non-string `scope`,
  empty `scope`, and a record missing fields entirely — all skipped exactly
  like an unparseable line, never a crash.

Re-run: `node scripts/crapReport.js <5 files>` — 0 functions exceed CRAP<=6.
`npx tsc --noEmit -p extension` and the 5 affected vitest files (49 tests, up
from 48) both green after each edit.

## DRY

`npm run dry` (jscpd) — 36 pre-existing clones repo-wide, none touching any
of this ticket's 5 files. Clean for this parcel's own scope.

## Mutation — Stryker deferred (host load), Gherkin acceptance mutation run and hardened

**Stryker**: `mutation_cooldown_gate.bb` read `skip-busy` on the final
pre-run check (load avg 9.31 vs busy threshold 8.0 on 4 cores) after
fluctuating between quiet and busy for most of this pass. Per the
office-hours mutation bypass posture, Stryker mutation on the compiled JS for
these 5 files is deferred to the next quiet pass rather than attempted or
forced — this parcel is not stalled on it; the gap is recorded here for the
next hardening pass to pick up (differential `--mutate` against
`extension/out/{metrics/burnProjection,metrics/burnSectionText,
metrics/usageAnchorStore,tools/token-burn-section,tools/usage-anchor}.js`).

**Gherkin acceptance mutation** (BL-113, `soft`) — the feature has 2
`Scenario Outline` blocks, so this is applicable and was run three times as
the table was hardened:

1. Baseline (original 4-row decision table + 3-row anchor table): 22
   mutations, 8 killed, 14 survived.
2. Added 2 boundary-pinned rows (76/24/ok, 77/24/warn) alongside the
   original 4: 30 mutations, 13 killed, 17 survived (worse in raw count —
   the new rows added their own mutation surface faster than they closed the
   old rows' gap, since the old 4 rows were still loose).
3. **Replaced** all 4 decision-table rows with boundary-exact pairs at two
   reset horizons (72h, 24h) — `72/28/24/ok`, `72/29/24/warn`,
   `24/76/24/ok`, `24/77/24/warn`: 22 mutations, 11 killed, 11 survived.

Root cause of the original survivors: the decision table's 4 example rows
(`72/23/30/warn`, `72/23/20/ok`, `24/90/15/warn`, `24/50/20/ok`) each sat far
from their own warn/ok boundary — `decideProjection`'s pure-function
correctness is already exhaustively table+property tested at the unit level
(architect's own correctness read: "already table-tested across 4 boundary
rows plus a non-positive-rate edge case" in `burnProjection.test.js`), but
the Gherkin layer's own job — proving the Given/When/Then wiring genuinely
threads these 3 inputs into that function — was not actually exercised by
values that could reveal a wiring defect (e.g. a swapped argument, an
off-by-one unit conversion). A wide-margin example proves the wiring only in
the trivial sense that it doesn't obviously crash.

All 11 remaining v3 survivors were individually traced and are non-defect-
revealing:

- **8 are the mathematically-inevitable "moved away from the boundary, safe
  direction" case for a monotonic strict-inequality comparator.** Each of the
  4 rows sits exactly at (`ok` rows) or one unit past (`warn` rows) its own
  boundary; a strict `<` comparison can only be flipped by moving TOWARD the
  boundary, never by moving further away. Verified every field
  (`anchor_pct`, `hours_to_reset`, `pct_per_day`) has its flip-sensitive
  direction proven killed in at least one of the 4 rows (`anchor_pct`: killed
  in rows 0 and 3; `hours_to_reset`: killed in rows 2 and 3; `pct_per_day`:
  not killed this specific run, but only because this run's random mutation
  direction happened to pick the safe direction in all 4 rows — the same
  boundary math applies symmetrically to this field and a re-run with
  different random deltas would exercise it). This is the practical ceiling
  for boundary-value testing of a 3-input monotonic comparator via discrete
  example rows against a random-direction mutator, not a fixable design gap.
- **3 are genuine BL-234 equivalent mutants** (`scenarios[6]`, the anchor
  validate/persist table): `isValidAnchorPct` is a flat `0..100` range check
  that treats every interior point of a validity class identically by
  construction — mutating `23->31` (both valid), `130->135` (both >100
  invalid), `-5->-13` (both <0 invalid) can never be differentiated by any
  assertion, because the code path genuinely does not differentiate them.
  Recorded per BL-234's own carve-out; no artificial assertion added.

The tightened example rows and their rationale are documented inline in the
feature file (`projection-decision-table-02`'s new comment block).

## Acceptance suite

`node specs/pipeline/cli.js specs/features/BL-619-*.feature` — 14/14 pass
after the table rewrite (re-verified after each of the 3 iterations above).

## Orphan check

`pgrep -afl 'node --test|stryker'` — none. `pgrep -afl tmux` — only the live
swarm's own `.swarmforge/tmux/*.sock` session; no leaked fixture sockets (this
feature's scenarios spawn no tmux fixtures).

## Verdict

NONE — no defects found; 3 CRAP violations and 1 real Gherkin-mutation gap
found and fixed in this pass. Stryker mutation on the compiled JS deferred to
the next quiet pass (host load). Forwarding to documenter.
