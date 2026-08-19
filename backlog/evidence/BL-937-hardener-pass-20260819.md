# BL-937 hardener pass — 2026-08-19

## Reviewed commit
`c5059ecee1` (merge of architect `68828484b5` into hardener).

## Tooling applicability (checked before running anything)
- **Stryker (mutation)**: not applicable. `stryker.conf` scopes `--mutate` to
  compiled `extension/out/**/*.js`. This parcel touches zero files under
  `extension/`.
- **CRAP**: not applicable. `crapReport.js`/`npm run crap` scope to
  `extension/src/*.ts` via `coverage/coverage-final.json`. No `.ts` file is
  in this parcel's diff.
- **DRY (jscpd)**: not applicable. `extension/.jscpd.json` pattern is
  `**/*.ts` under `extension/src`. No `.ts` file is in this parcel's diff.
- Parcel is 6 shell scripts, one acceptance step-handler file
  (`specs/pipeline/steps/bl937ShellScriptsRunOnStockMacosBash32Steps.js`,
  outside the coverage/mutation instrumentation boundary — drives real
  subprocesses, not pure logic), and `specs/pipeline/steps/index.js`
  registration. No language-level mutation tool is wired for any of these.

## Host load / cooldown gate (BL-149)
`uptime` at pass start: `load averages: 43.96 32.02 26.39` on 4 cores
(`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, this host has no `nproc`, per the
standing macOS workaround). Ran `mutation_cooldown_gate.bb` against all 6
changed shell scripts — every one reported `DECISION: skip-busy`
(`busy_threshold: 2.00x`, load read 31.52 at the time of the sweep). Load
stayed above the 2x-cores busy threshold throughout the pass (12.51 1-min at
the following check).

Per the load rules (bind every mutation runner, Gherkin mutation included)
and the office-hours bypass: **the BL-113 Gherkin acceptance-mutation pass
over this ticket's `Scenario Outline` examples is deferred to the next quiet
host**, not skipped outright. This does not weaken the gate — targeted-test
hardening below stands in for this pass; the coordinator's mutation-heavy
scheduling should route a follow-up quiet-host pass here per BL-149/office-
hours policy. No `.stryker-tmp`/mutation manifest touched.

## Targeted-test hardening performed instead
1. **Invariant-proof test, re-run independently**:
   `/bin/bash swarmforge/scripts/test/test_bl937_portable_mapfile_replacement.sh`
   → 6/6 PASS (empty output, trailing newline, no-trailing-newline final
   line, single line no newline, spaces/tabs/backslash preserved verbatim,
   BL-801 empty-array `set -u` guard). Matches the architect's own
   independent non-vacuity check.
2. **Acceptance pre-check** (`node specs/pipeline/cli.js
   specs/features/BL-937-shell-scripts-run-on-stock-macos-bash-32.feature
   specs/pipeline/generated specs/pipeline/steps/index.js`), run to
   completion under real `/bin/bash` subprocesses (no compile step needed —
   nothing under `extension/` changed, so `out/` staleness does not apply
   here):
   - 6/7 scenarios PASS.
   - The one failure is subtest 2 of scenario 01
     (`test_handoffd_aged_note_rotate_wiring.sh`), failing at "it reports
     every scenario passing" with `chase-rotate-error cleaner
     not-a-rotation-router` in the captured log — byte-for-byte the D1
     defect the architect and coder already surfaced-not-fixed in
     `BL-937-surfaced-defects-not-fixed-20260819.md` and raised via `note`
     per the ticket's own constraint. Confirms the acceptance step handler
     is honest (not weakened, not hidden) and the port itself is not
     implicated — a pre-existing `rotate-gate-decision` refusal, orthogonal
     to array-reading semantics.
   - Scenario 02 (construct scan) and scenario 03 (both operator-script
     rows) all pass clean.
3. **Process/fixture hygiene after the run**: `pgrep -afl 'node --test|
   stryker'` and `pgrep -afl tmux` (filtered to non-live sockets) show
   nothing leaked; `git status --short` clean — the step handler's own
   `guarded`/`terminal` wrappers cleaned up every `mkdtemp` fixture root.

## Verdict
No new defect found. The parcel's own invariants hold under independent
re-run. The one known, out-of-scope acceptance failure (D1) is confirmed
identical to the architect's finding and already routed by `note`, not this
parcel's to fix (ticket's own constraint: "If a ported test turns out to
FAIL on a real assertion once it can finally execute, that is a SEPARATE
defect... do not fix it here"). No mutation/CRAP/DRY tooling applies to this
parcel's changed files; a BL-113 Gherkin mutation pass is deferred to a
quiet host per the load rules, not skipped.

Forwarding to documenter.

By hardener.
