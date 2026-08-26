# BL-780 — architect bounce — 20260826

- Reviewed cleaner tip `e06484156f` (detached; 24 paths vs `origin/main`).
- BL-780 surface is otherwise sound (see gates below).

## Inventory (one bounce)

### D1 — behavior: land diff un-lands BL-593 and bundles BL-784 — blamed: cleaner

**Evidence**

- vs `origin/main`: **renames** `backlog/done/M8/BL-593-...` → `active/` (R100);
  drops `topics/BL-593.json` and QA pass evidence.
- Also carries full BL-784 daemon-freshness supervisor stack (15 paths) and
  BL-748 yaml move — not BL-780 scope.
- Coder commit `e06484156f` stat is BL-780-only (5 paths: `handoffd.bb`,
  `mono_router_lib.bb`, tests, `swarmforge.conf`).

**Required remediation**

- Re-cut from current `origin/main`; land diff ~5 BL-780 paths only.
- Preserve `backlog/done/M8/BL-593-...`.
- Verify: `git diff --name-only origin/main..TIP | rg 'BL-593|BL-784|daemon_log_freshness|BL-748'` — empty.

## What is otherwise sound (BL-780 surface)

| Gate | Result |
|---|---|
| `test_bl780_rotation_actionability_ordering.sh` | ALL PASS |
| `mono_router_lib_test_runner.bb` | ok |

`note_actionable_after_ms` default below `flow_watchdog_warn_ms` — pure conf + router lib.

## Verdict: BOUNCE — do not forward to hardender.

By architect.
