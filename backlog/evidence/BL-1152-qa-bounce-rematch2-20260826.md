# BL-1152 QA bounce rematch2 — 20260826

**Commit checked:** `38c6836d8` (merge documenter `375047095d`)
**Task:** `BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686`
**Routing:** `architect`

## Gates PASS (BL-1152 surface)

| Gate | Result |
|------|--------|
| Sibling deferral | VERIFY BL-1152 |
| BL-1152 unit / mutation / acceptance | all pass |
| Cleaner re-cut `537116c2fc` vs `origin/main` | **PASS** — 8 paths, zero hitchhikers |

## Gates FAIL

| Gate | Result |
|------|--------|
| Tip purity at documenter tip (BL-506) | **FAIL** — D1 |

## Defects

**D1 — behavior (blame: architect):** Architect rematch2 "clean re-forward" `2145551ce` reintroduced 57 non-backlog paths vs clean recut `537116c2fc` — not additive onto `origin/main` (65 hitchhiker matches at documenter tip).

- **Failing command:** `git diff --name-only origin/main..375047095d | rg '653|660|588|1162|1160|operator_enqueue|swarmShift' | wc -l`
- **Commit hash:** `38c6836d8`
- **Failure class:** behavior
- **Expected vs observed:** Expected architect rematch2 re-forward to match BL-1162 `89545ab60` discipline (detached recut only). Observed architect tip still carries stacked sibling diff.

**Remediation:** Re-forward from detached `537116c2fc` onto `origin/main` without merging into polluted architect branch; verify hitchhiker grep empty before forwarding.

## Inventory

D1 (architect).

By QA.
