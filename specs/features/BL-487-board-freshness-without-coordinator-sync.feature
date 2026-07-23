Feature: the pipeline board reflects live role-held stage without depending on the coordinator running sync

  # BL-474 audit finding #1 (highest leverage). Today .swarmforge/board/
  # ticket-stage-map.json is a lazily-invalidated cache whose ONLY invalidator
  # is the coordinator LLM remembering to run `pipeline_stage_cli.bb sync` — the
  # concierge tick reads the file each ~30s and never recomputes. A skipped,
  # crashed, or cooldown'd sync leaves a genuinely-held ticket mis-staged for an
  # unbounded time (live 2026-07-17: the map held 2 of 6 active tickets). The
  # fix makes board freshness recompute from the live in_process mailboxes on the
  # tick — pipeline_stage_cli.bb `report` is already side-effect-free, so the
  # concierge tick can drive the same computation instead of trusting a
  # coordinator-written cache. Implementation approach (shell out to `report` vs
  # reimplement the invert in TS over live mailboxes) is the architect's call;
  # the observable freshness contract below is the same either way.

  Background:
    Given active ticket "BL-900" is held in the coder's in_process mailbox

  # BL-487 board-freshness-without-coordinator-sync-01
  Scenario: a role-held active ticket appears on the board even when the coordinator never refreshed the cache
    Given the persisted ticket-stage-map cache does not contain "BL-900"
    When the concierge tick computes the pipeline board
    Then "BL-900" appears on the board at the coder's stage

  # BL-487 board-freshness-without-coordinator-sync-02
  Scenario: a stale cached stage is corrected from the live in_process mailboxes on the tick
    Given the persisted ticket-stage-map cache still says "BL-900" is held by the specifier
    When the concierge tick computes the pipeline board
    Then "BL-900" appears on the board at the coder's stage, not the specifier's
