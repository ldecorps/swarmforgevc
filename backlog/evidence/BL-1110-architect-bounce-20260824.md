# BL-1110 — architect bounce — 20260824

## Reviewed commit

Cleaner tip `6b1e95f2ad` (on coder `15e4c5da77`) merged into
`swarmforge-architect` (conflict in `specs/pipeline/steps/index.js`
resolved: wire BL-1110 + BL-1093; omit BL-1102 require — those files are
absent on this branch after the hitchhiker bounce revert). Ancestry
confirmed. Restored ticket YAML `paused/` → `active/` (misplaced by the
prior BL-1102 merge revert).

## BL-1110 own gates (for completeness — not defects)

| Gate | Result |
|---|---|
| Mid-cycle `handoffd.sweep-marker` suppress (`suppress-in-sweep`); threshold stays 120 | Architecture OK — aligns cron with BL-977 supervisor trust |
| Cleaner tighten of `in_flight_sweep_under_budget` | Structure OK (early returns / single age predicate) |
| BL-1110 checks in `test_daemon_log_freshness.sh` | PASS (suite still ends FAILURES on standing BL-796 nvm-PATH — grepped **BL-796**, already ticketed) |
| BL-1110 acceptance | 3/3 |
| `bl1110HandoffdHeartbeat.property.test.js` | 2/2 |
| Dep-gate | PASSED |
| Conf `handoffd\|120` | unchanged |

Invariant 2 satisfied: budget not raised as sole fix. Own work is clean.

## Review inventory (Article 4.4) — land tip blockers

### D1 — acceptance — blamed: coder

- **Failing command:**
  `node specs/pipeline/cli.js specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`
  → EXIT=1; board Outline: no step for `HTML numeric nbsp entity`.
- **Commit hash checked:** `6b1e95f2ad` (post-merge tip)
- **Failure class:** `acceptance`
- **Expected vs observed:** HOTFIX_PATHS blobs match `27273f2b0a` (pack +
  board OK; properties green). Feature Then-line still hitchhiked to
  `numeric nbsp` without a matching step.
- **Remediation:** Restore feature wording to stamped `HTML nbsp entity`
  (same as `a966f07948` / prior architect bounces on BL-1093 / BL-1102 /
  telegram-board-nbsp-reapply). Do not land BL-1110 under a red stamp-off.

### D2 — behavior (docs / done-ticket narrative) — blamed: coder

- **Evidence:** `docs/reference/Specification.MD` (and done/M8 BL-1113 yaml
  when present on tip) still claim `&#160;` while production emits `&nbsp;`.
- **Failure class:** `behavior`
- **Remediation:** Align narrative with stamped blob or complete a separate
  BL-848 stamp-off after human decision.

## Routing

Earliest owning role: **coder**. Keep BL-1110 sweep-marker suppress; clear
stamp-off hitchhikers before re-forwarding.

By architect.
