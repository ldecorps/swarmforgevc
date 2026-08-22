# BL-638 hardener review — clean pass, NONE

**Ticket:** BL-638 — Gherkin acceptance mutation reports `Total 0` as a pass for
any feature without a Scenario Outline, and stamps the file so later runs skip it.
**Reviewed commit:** 957f76da62 (received from architect via merge_and_process).
**Role:** hardener.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **BL-149 mutation cooldown gate (first stage, ahead of the load check).**
   Ran `mutation_cooldown_gate.bb` (with `SWARMFORGE_MUTATION_GATE_FORCE_CORES`
   set from `sysctl -n hw.ncpu`, per the accepted macOS-no-`nproc` workaround)
   against every changed production file:
   `specs/pipeline/gherkinMutationClassify.js`,
   `specs/pipeline/gherkinMutationManifest.js`,
   `specs/pipeline/gherkinMutationOutcome.js`,
   `specs/pipeline/scripts/finalize_gherkin_mutation.js`,
   `specs/pipeline/scripts/run_gherkin_mutation.sh`,
   `specs/pipeline/steps/bl638GherkinMutationZeroMutantsSteps.js`,
   `specs/pipeline/steps/index.js`. All seven returned `DECISION: skip-cooldown`
   (committed today, inside the 3-day window). No Stryker mutation run this
   pass for any of them — correctly deferred, not skipped through negligence.

2. **Host load.** `uptime` showed load averages 182–188 on 4 cores (~45x),
   well over the 2x-cores threshold. Per the load-avg rule, did not attempt
   any full-suite or Stryker run (moot here — cooldown already excludes every
   changed file) and used targeted `node --test` / scoped `vitest` invocations
   instead of the full suite.

3. **Targeted unit tests** for the new pure/wrapper modules — BOTH files run
   individually and combined, counts match architect's evidence exactly:
   `specs/pipeline/test/gherkinMutationOutcome.test.js` (15/15) and
   `specs/pipeline/test/finalizeGherkinMutation.test.js` (10/10) — 25/25 green.

4. **Acceptance pre-check** — `run_acceptance.sh` against
   `specs/features/BL-638-gherkin-mutation-zero-mutants-reads-as-a-pass.feature`
   into a fresh `./tmp/` work dir, real vendored mutator, no fakes: all 7
   scenarios pass. No extension `out/` compile needed — the new step handler
   only requires `node:fs`/`node:os`/`node:path`/`node:child_process` and the
   sibling `gherkinMutationOutcome.js`, nothing under `extension/`. Work dir
   removed after the run.

5. **Property test** — `bl638ZeroMutantNeverReadsAsPass.property.test.js` run
   directly via `vitest run --config vitest.properties.config.mjs
   test/bl638ZeroMutantNeverReadsAsPass.property.test.js` (targeted, not the
   full `test:properties` sweep, given host load): 3/3 green, both invariant
   halves. Kept out of coverage/mutation/CRAP/DRY scope per the standing
   separation rule — it already is (vitest.config.mjs excludes
   `**/*.property.test.js`).

6. **Dogfood: ran the fixed wrapper against BL-638's own feature file**
   (deliberately outline-free) at the default `soft` level:
   `summary.Total=0`, `outcome: "inapplicable"`, exit code `2` — distinguishable
   from both a pass (`0`) and a fail (`1`), exactly as designed. Confirmed via
   `git diff` that the file gained only the informational manifest block
   (`outcome":"inapplicable","scenarios":[]`) and **no** suppressing
   `# mutation-stamp:` line. Reverted the resulting worktree diff
   (`git checkout --`) afterward so this dogfood run leaves no residue in the
   tracked feature file.

7. **CRAP / DRY — not applicable**, consistent with the established
   disposition for this same area (see `backlog/evidence/BL-577-hardener-pass-20260724.md`).
   `npm run crap` / `npm run dry` (jscpd) both scope to `extension/src/*.ts`
   (`extension/.jscpd.json` pattern `**/*.ts`; `crapReport.js` keyed off
   `coverage-final.json`, itself scoped to `extension/src` via
   `vitest.config.mjs`). None of this ticket's changed files live under
   `extension/src` — nothing to run or fix. `swarmforge/roles/hardender.prompt`
   is a prompt/doc file, not code under either tool's scope.

8. **Manifest / stamp mechanism integrity.** No manifest or stamp file was
   hand-edited; the only write observed was the wrapper's own corrective
   write in step 6, and it was reverted after inspection.

9. **Orphaned process check.** Before and after this pass:
   `pgrep -fl 'node --test|stryker|bb gherkin-mutator|vitest'` returned
   nothing — no leftover processes from this or a prior run.

10. **No new product behavior added.** This pass added no tests beyond what
    coder/cleaner/architect already landed — every check above verifies
    existing coverage rather than adding to it, because nothing surfaced that
    needed strengthening.

## Disposition

PASS. Forwarding to documenter.
