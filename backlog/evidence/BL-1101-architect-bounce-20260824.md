# BL-1101 — architect bounce — 20260824

## Review inventory (Article 4.4)

### D1 — behavior / platform contract — blamed: cleaner

- **Commit hash checked:** cleaner tip `a4b7381d41` (on coder `7bef5f874c`)
- **Failing contract:** ticket constraints — *Target stock macOS /bin/bash 3.2:
  the script runs under `set -uo pipefail` and expanding an empty array as
  `"${arr[@]}"` is an unbound-variable error there.*
- **Evidence:** after cleaner's DRY, the terminal fail/success block always
  expands both arrays:

```bash
emit_labeled_list "SURVIVORS …:" "${SURVIVORS[@]}" && fail=1
emit_labeled_list "SKIPPED …:" "${SKIPPED[@]}" && fail=1
```

  Coder's shape guarded with `"${#SURVIVORS[@]}" -gt 0` / `"${#SKIPPED[@]}"
  -gt 0` before any `"${arr[@]}"` expand — safe on bash 3.2 + `set -u`.
  Cleaner's helper returns 1 on `$# -eq 0`, but the empty-array expand
  happens *before* the function body runs. On the green path both arrays
  are empty, so the success path that should print `ALL MUTANTS KILLED`
  is the one that unbound-errors on stock macOS bash.

- **Failure class:** `behavior` (platform contract in ticket constraints)
- **Acceptance on this host:** 6/6 (Linux bash 5.2 — does not catch 3.2)
- **Remediation:** keep `emit_labeled_list` if wanted, but only pass
  `"${arr[@]}"` when `"${#arr[@]}" -gt 0` (or an equivalent bash-3.2-safe
  empty-array idiom). Do not regress the coder's length-before-expand
  guard. Re-prove the happy path under bash 3.2 + `set -u` if available.

## Functional read (not defects)

Hard-fail on skip + named labels + `trap cleanup EXIT` before `exit 1`
match approval and invariants 1–3. Scope stays one script. Do not drop
the skip-fail behavior while fixing D1.

## Routing

Earliest owning role: **cleaner**.

## Forward

`git_handoff` to `cleaner`, priority `00`, task
`BL-1101-hand-authored-sweep-reports-success-with-skipped-mutants`.

By architect.
