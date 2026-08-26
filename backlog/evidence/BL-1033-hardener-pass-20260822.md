# BL-1033 hardener pass — 2026-08-22

**Parcel:** architect-forwarded commit `0f99367208` ("Merge BL-1033 from
architect (0f99367208) into hardener" — the architect pass itself added only
its own evidence file; the fix landed earlier via `743d46fa95`, already
present on this branch from the BL-1060 merge earlier this session). Merged
cleanly, no conflicts.

## BL-149 cooldown gate

    bb swarmforge/scripts/mutation_cooldown_gate.bb "$(pwd)" \
      swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb

`DECISION: skip-cooldown` (file_age_days 0.59, cooldown 3 days) — the fixed
file has been actively churning through coder/cleaner/architect passes today.
Per the gate: no additional (hand-authored or differential) mutation testing
of this file this pass, regardless of host load. This does not exempt
running its own existing suites, which are the ticket's actual acceptance
gate and are run below.

## Suites re-run directly (all green, matching architect's report)

- `bb swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`
  — 32 cases, exhaustive, ALL PROPERTIES HOLD.
- `npx vitest run test/tempDirTrapGuard.test.js` — 4/4 pass (was RED at HEAD
  before this fix, on exactly this file).
- `bb swarmforge/scripts/test/bl1033_temp_root_cleanup_property_runner.bb` —
  30 runs, 20 distinct throw points (floor 10), all category floors met
  (`:throw` 24/14, `:normal` 3/2, `:broken-sweep` 3/2, `:leaky-window` 13/8,
  `:post-setup` 11/5 — `:shim-never-fired` is tracked but carries no floor,
  0 is not a gap), ALL PROPERTIES HOLD.
- `bash swarmforge/scripts/test/test_bl1033_property_runner_temp_root_survives_a_throw.sh`
  — 4/4 pass, including a real SIGTERM kill mid-run.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh` on the feature) —
  5/5 pass.

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1033-property-runner-temp-root-survives-a-throw.feature \
      ./tmp/bl1033-mutation-workdir \
      specs/pipeline/steps/index.js \
      soft

Result: `outcome: pass`, **2/2 killed**, 0 survived, 0 errors — the single
`Scenario Outline`'s two `<ends>` examples ("throws from its git helper" /
"fails its exhaustive-sweep guard"). The other three scenarios are plain
`Scenario:`s with no `Examples:` to mutate. Manifest embedded in the feature
file. Mutation workdir removed; no `gherkin-mutator`/`mutationWorker.js`
processes left running.

## Tooling scope

No `extension/src/*.ts` file touched anywhere in this ticket's history
(`git log --oneline <coder-base>..<parcel> -- '*.ts'` — empty) — pure
Babashka/shell fix plus one JS step-handler file (test infrastructure).
CRAP/DRY do not apply; Stryker does not apply. Per engineering.prompt's
untooled-surface fallback, coverage is carried by the runner's own 32-case
exhaustive sweep, the new property runner, the shell integration test, and
BL-113 Gherkin mutation above — all independently re-run, not assumed.

## Guard sweep (parcel touches `specs/pipeline/steps/`: new
`bl1033TempRootCleanupSteps.js`, edited `index.js`)

    cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')

**13/13 guard files pass, 125/125 tests.** Notably `tempDirTrapGuard.test.js`
— the same standing pre-existing violation flagged during today's BL-1028
hardening pass (evidence: `backlog/evidence/BL-1028-hardener-pass-20260822.md`)
and confirmed already-ticketed as this very ticket — is now clean over the
whole `swarmforge/scripts` tree. The loop closes: the defect I ruled out of
scope for BL-1028 is fixed here, by its own dedicated ticket.

## Orphaned processes

Checked before and after every run — clean throughout (two transient
`pgrep` matches during the pass had already exited by the time they were
inspected; nothing left running under this worktree).

## Verdict

Hardened. The invariant ("a fixture temp root is removed on every exit
path") is proven by the runner's own exhaustive sweep, a floored property
test covering 20 distinct throw points across two coverage classes, a real
SIGTERM-kill shell scenario, and 2/2 Gherkin mutation kills on the one
Outline — no survivors anywhere. The standing `tempDirTrapGuard` whole-tree
sweep is now clean. No TS touched; CRAP/DRY/Stryker not applicable per the
cooldown gate and the untooled-surface fallback. Forwarding to documenter.

By hardender.
