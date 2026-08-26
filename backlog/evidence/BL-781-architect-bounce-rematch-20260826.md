# BL-781 — architect bounce (rematch) — 20260826

- Reviewed cleaner tip `e58133d853` (detached; 45 paths vs `origin/main`).
- Same tip re-delivered after prior bounce tonight; hitchhike unchanged.
- BL-781 surface is otherwise sound (see gates below).

## Inventory (one bounce)

### D1 — behavior: land diff bundles sibling stack — blamed: cleaner

**Evidence**

- vs `origin/main`: BL-752 appears under `backlog/active/` while `origin/main`
  has it in `done/M8/` — un-lands QA-approved ticket.
- Tip also carries BL-779 feature/steps, BL-784 daemon-freshness stack,
  BL-980 tests/steps — not BL-781 scope.
- Coder merge `d42ede9b25` is BL-781-only (retire `babysitter_assess.bb`,
  `babysitter_enqueue_wake.sh`, `babysitter_lib.bb`, test runner, bl611 steps).

**Required remediation**

- Re-cut from current `origin/main`; land diff ~6 BL-781 paths only.
- Preserve `backlog/done/M8/BL-752-...`.
- Verify: `git diff --name-only origin/main..TIP | rg 'BL-752|BL-779|BL-784|BL-980|daemon_log_freshness'` — empty.

## Gates (BL-781 slice — PASS)

| Gate | Result |
|---|---|
| `test_babysitter_check.sh` | ALL PASS |
