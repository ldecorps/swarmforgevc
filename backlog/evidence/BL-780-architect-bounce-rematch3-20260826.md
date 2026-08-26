# BL-780 — architect bounce (rematch3) — 20260826

- Reviewed cleaner tip `e06484156f` (detached; 66 paths vs `origin/main`).
- Same tip re-delivered twice tonight after prior bounces; hitchhike unchanged.
- BL-780 surface is otherwise sound (see gates below).

## Inventory (one bounce)

### D1 — behavior: land diff bundles BL-593/736/752/784 — blamed: cleaner

**Evidence**

- vs `origin/main`: BL-593, BL-736 un-land (`done/M8` → `active/`); BL-752
  paused yaml churn while main has it in `done/M8/`.
- Tip carries BL-784 daemon-freshness stack (15+ paths), BL-736 lifecycle-help
  scripts — not BL-780 scope.
- Coder cherry-pick `45997d5b8f` is BL-780-only (~5 paths: `handoffd.bb`,
  `mono_router_lib.bb`, test runner, bl780 test, `swarmforge.conf`).

**Required remediation**

- Re-cut from current `origin/main`; land diff ~5 BL-780 paths only.
- Preserve `backlog/done/M8/BL-593-...`, `BL-736-...`, `BL-752-...`.
- Verify: `git diff --name-only origin/main..TIP | rg 'BL-593|BL-736|BL-752|BL-784|daemon_log_freshness'` — empty.

## Gates (BL-780 slice — PASS)

| Gate | Result |
|------|--------|
| `test_bl780_rotation_actionability_ordering.sh` | ALL PASS |
