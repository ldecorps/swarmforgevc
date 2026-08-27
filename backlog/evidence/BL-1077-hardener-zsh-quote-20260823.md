# BL-1077 hardener pass — zsh qwen_guard quote fix — 2026-08-23

Merged architect tip `382df5e012` (zsh quote fix via shared `qwen_lib_source`).

## Cooldown

- `swarmforge/scripts/swarmforge.sh` — `skip-cooldown` (file_age_days 0.35).
  No full Stryker; shell has no Stryker lane anyway. Targeted hand-mutation +
  strengthened invariant only.
- Soft Gherkin mutation: prior stamp valid (`total=0 skipped_scenarios=2`);
  manifest remains Killed 3+3 / Survived 0.

## Gaps found and closed

Hand probes against the cleaner/coder tip showed two survivors the prior
invariant checks did not kill:

1. **Dead `qwen_lib_source`** — assignment present, both branches re-state the
   source path. Grep-for-`qwen_lib_source=` alone passed.
2. **Broken ANSI-C nesting inside the assignment** — `$'\''"$SCRIPT_DIR"'`
   form that still left `qwen_lib_source=` present; zsh source of the outer
   file sometimes still succeeded depending on how the line closed.

## Killers added

`test_qwen_credential_name_invariant.sh` now requires:

- Exact safe assignment:
  `qwen_lib_source="source '${SCRIPT_DIR}/qwen_launch_guard_lib.sh'"`
- `${qwen_lib_source}` expanded on **both** guard branches (count ≥ 2)
- Absence of the broken ANSI-C nesting fragment
- zsh `source` of `swarmforge.sh` still succeeds

Durable sweep: `swarmforge/scripts/test/bl1077_qwen_guard_quote_mutation_sweep.sh`
— 5/5 killed (M1–M5).

## Unit

- `test_qwen_credential_name_invariant.sh` — green
- `test_qwen_launch_guard_lib.sh` — green
