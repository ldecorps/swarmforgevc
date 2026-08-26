# BL-1152 — architect pass rematch3 — 20260826

- QA bounce rematch2 D1 (blame: architect): hardener received clean `f095fbeea6`
  (17 paths, zero hitchhikers) but `merge_and_process` produced polluted tip
  `2145551ce` (75 hitchhiker matches) — architect branch `merge -s ours` must
  not substitute for the forwarded commit hash; hardener must apply the handoff
  commit tree directly onto `origin/main`, not fold into stacked lineage.
- This forward: detached chain `537116c2fc` → `f095fbeea6` → this commit only.

## Verification

- Purity vs `origin/main`: hitchhiker grep — empty
- `vitest -t BL-1152`: 5/5 PASS
- Hotfix `7380d80686` byte-identical

Pass → hardender (use forwarded commit hash tree as BL-1152 land diff).

By architect.
