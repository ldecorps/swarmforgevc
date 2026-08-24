# BL-1102 — architect bounce — 20260824

## Reviewed commit

Cleaner tip `212b012649` (on coder `31dce875c1`) merged into
`swarmforge-architect`. Ancestry confirmed.

## BL-1102 own gates (for completeness — not defects)

| Gate | Result |
|---|---|
| `sh!` returns `:spawn-failed?` / exit 127; distinguishable from 124 / real exit | Architecture OK (mirrors babysitter_check shape) |
| Cleaner split `spawn-failure-result` / `await-bounded-process` | CC/structure OK |
| `daemon_cycle_guard_lib_test_runner.bb` | ALL PASS |
| BL-1102 acceptance | 6/6 |
| `bl1102SpawnFailure.property.test.js` | 3/3 |
| Dep-gate on property test | PASSED |

The spawn-failure contract itself is sound. The tip is **not landable**:
hitchhikers red the BL-1113 stamp-off (same class as BL-1094 QA bounce /
BL-1093 architect bounce / telegram-board-nbsp-reapply bounce).

## Review inventory (Article 4.4)

### D1 — acceptance — blamed: coder

- **Failing command:**
  `node specs/pipeline/cli.js specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`
  → EXIT=1 (board Outline: no step for `HTML numeric nbsp entity`).
- **Commit hash checked:** `212b012649`
- **Failure class:** `acceptance`
- **Remediation:** Restore feature Then-line to stamped
  `HTML nbsp entity` (named `&nbsp;`), matching
  `bl1113CursorHotfixStampOffSteps.js` / `27273f2b0a`. Parallel restore tip
  `a966f07948` / telegram-board-nbsp-reapply is the reference.

### D2 — behavior (HOTFIX_PATHS) — blamed: coder

- **Failing command:**
  `npx vitest run --config vitest.properties.config.mjs test/bl1113CursorHotfixStampOff.property.test.js`
  → invariant 1 RED: `swarmforge/packs/cursor-forge.conf` diverges from
  `27273f2b0a` (three Operator/front-desk comment lines from
  `f560ae2c80`, not BL-1102).
- **Failure class:** `behavior`
- **Remediation:** Strip those comments off the land tip or mint a separate
  stamp-off after human certify/waive. Windows still match; comments alone
  still break blob identity.

### D3 — behavior (docs / done-ticket narrative) — blamed: coder

- **Evidence:** `docs/reference/Specification.MD` and
  `backlog/done/M8/BL-1113-…yaml` still claim `&#160;` while production
  emits `&nbsp;` (pending ledger `27273f2b0a`).
- **Failure class:** `behavior`
- **Remediation:** Same strip/stamp-off discipline as D1–D2 of
  `telegram-board-nbsp-reapply-architect-bounce-20260824.md` and
  `BL-1093-architect-bounce-20260824.md`.

## Routing

Earliest owning role: **coder**. Keep BL-1102 `sh!` spawn-failure work;
clear stamp-off hitchhikers before re-forwarding.

By architect.
