# BL-1150 — architect pass — 20260826

**Tip:** cleaner `feca1c92a8` (coder `424e94ee20`)
**Handoff:** `00_20260826T021655Z_000876_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Authorize **BL-1150 paths only** (CLI entrypoint guard + handoffd load-order
+ regression/APS/docs). QA stages per BL-506.

## Architecture

- `outage_failover_cli.bb`: `(-main)` behind `(= *file* babashka.file)` —
  same load-file-safe shape as `post_hotfix_merge_origin.bb`; handoffd can
  `load-file` without `System/exit`.
- `handoffd.bb`: `outage-driven-seat-failover-sweep!` defined after
  `role-mailbox-idle?` (SCI analysis order / hotfix `ca45facb4`); cleaner
  fixed docstring placement before the arg vector.
- No extension-host/webview/tmux boundary issues — swarm-script CLI + daemon
  wiring only.

## Invariants

1. load-file never exits / never runs `-main` — bb harness
   `test_outage_failover_cli_load_file_safe.bb` + source-shape property.
2. Entrypoint still reaches `-main` — unit/APS entrypoint scenarios.

## Property coverage

Coder property encodes source-guard shape (`node:test` import; BL-1124 may
block committing removal). Behavioral bar is the bb load-file harness.
No additional undeclared properties needed.

## Verification

| Check | Result |
|-------|--------|
| `bb test_outage_failover_cli_load_file_safe.bb` | PASS |
| `vitest` unit | 3/3 |
| `node --test` property | 1/1 |
| `dependency-gate.js` on APS steps | PASSED |
| Ancestry `feca1c92a8` ⊂ HEAD | OK |

By architect.
