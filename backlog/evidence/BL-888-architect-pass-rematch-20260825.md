# BL-888 — architect pass (property rematch) — 20260825

**Tip:** cleaner `bd5e30bf9d` (coder property rematch + cleaner DRY)
**Prior bounce:** `b91011afa5` / `BL-888-architect-bounce-20260825.md` (D1 invariant-unencoded)
**Handoff:** `50_20260825T132435Z_000813_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE. D1 cleared.

## Scope / tip purity

`origin/main...bd5e30bf9d` = **9 paths**, BL-888-only. Hitchhike CLEAN.

## Architecture

- Root-scoped match/reap via `copilot_argv_matches_root` /
  `copilot_pids_for_root` / `reap_copilot_pid`; no unscoped
  `pkill -f 'copilot.*SwarmForge'`. Fixture seam
  `SWARMFORGE_COPILOT_PS_FILE`. required_wiring includes property runner.

## Invariants (1) — encoded, green

| # | Encoding | Verified |
|---|---|---|
| 1 | Kill signals only this root's processes | `bl888_copilot_kill_scope_property_runner.sh` 200/200 + non-vacuity vs broken (no-ROOT) oracle |

APS **3/3**; unit `test_kill_pipeline_copilot_scope.sh` ALL PASS (incl. #06).

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-888-teardown-copilot-pkill-unscoped-kills-siblings`, commit = this tip.
Authorize BL-888 paths only.

By architect.
