# BL-640-constitution-reference-amendments-have-no-delivery — hardener pass

Merged architect's round-2 commit `07a8ff93e6` (D1/D2 remediation verified,
5/5 acceptance green). No prior hardener pass on this ticket.

## Gherkin mutation (BL-113): inapplicable, per BL-638

`specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
carries only plain `Scenario:` blocks, no `Scenario Outline:`/`Examples:` —
`run_gherkin_mutation.sh` would report `outcome: "inapplicable"` (exit 2),
not a pass. Per BL-638, fell back to a hand-authored surgical mutation
sweep over the parcel's own changed behavior instead.

## BL-149 mutation cooldown gate

Ran against both core changed files with the macOS `nproc`-missing
workaround (`SWARMFORGE_MUTATION_GATE_FORCE_CORES=$(sysctl -n hw.ncpu)`):
both `reference_freshness_lib.bb` and `ready_for_next.bb` reported
`DECISION: skip-busy` (load_avg 26.21 on 4 cores, busy_threshold 2.00x).
Consistent with the office-hours mutation bypass — defers a heavier pass to
a quiet host without stalling the pipeline. The hand-authored sweep below
stands in for this pass, matching the BL-567/BL-638 precedent for `.bb`
code with no wired mutation tool.

## Hand-authored mutation sweep

Pure logic (`reference_freshness_lib.bb`), verified via
`reference_freshness_lib_test_runner.bb`:

- M1: `stale-paths` predicate `not=` -> `=` — **KILLED**
- M2: `stale-paths` drops the `sort` step — **KILLED**
- M3: `sha256-hex` format `%02x` -> `%02d` — **KILLED**
- M4: `staleness-report` tag `STALE_REFERENCE_ELABORATION` typo'd — **KILLED**
- M5: `staleness-report` drops the "Merge main, then run..." instruction — **KILLED**

IO wiring (`ready_for_next.bb`), verified via
`test_reference_freshness_guard.sh` (real git fixtures, both the no-origin
and origin-ahead cases):

- M6: `freshest-main-ref` ahead-comparison `>` -> `<` (would pick the wrong
  ref when origin/main is actually ahead) — **KILLED** by the D2
  origin-ahead fixture scenario.
- M7: `enforce-reference-freshness-guard!` trigger `(seq stale)` ->
  `(empty? stale)` (inverts refuse/pass) — **KILLED** by scenario 02.

All 7/7 mutants killed. Each mutant applied via `sed`, run against its test
file, then reverted; `git status --short` confirmed clean before and after
the sweep — no residual diff.

## Full re-verification

- `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` — ALL PASS
  (4/4 markers).
- `bb swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb` — ok.
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` — ok (04/06).
- `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  — 5/5 PASS.
- CRAP/DRY: N/A — this ticket touches zero `extension/src/*.ts` files
  (`git diff --stat` against the ticket's own commit range shows no
  `extension/` changes at all).
- Fixture/process hygiene: no orphaned `node --test`/`stryker`/`bb` test
  processes scoped to this worktree; live tmux sessions present are all
  under `.swarmforge/*.sock` (real swarm sessions, not fixture leaks under
  a temp dir) — nothing to reap.

No survivors, no lessons worth a `rule_proposal` this pass. Forwarding to
documenter.

By hardender.
