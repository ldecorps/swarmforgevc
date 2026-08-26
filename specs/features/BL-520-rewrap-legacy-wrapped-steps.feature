Feature: legacy wrapped-step feature files are rewrapped and drained from the BL-515 allowlist

  # BL-520 (swarm-surfaced follow-up to BL-515, 2026-07-18): BL-515's lint gate rejects a Gherkin
  # step that wraps onto a bare continuation line (the vendored APS parser silently drops that line
  # and any <param> on it). To avoid retroactively blocking 19 already-landed feature files, BL-515
  # grandfathered them in swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt. This ticket drains
  # that debt: rewrap each file to single-line steps and remove its allowlist entry, until the list
  # is empty and the exemption is gone.
  #
  # The catch (see the ticket notes): the parser drops the continuation today, so each affected
  # scenario's step handler is registered against the TRUNCATED first line. Rejoining restores the
  # FULL step text the runtime matches, so the handler must be reconciled to that full text in the
  # SAME parcel or the acceptance runner throws (BL-233) — and a <param> the wrap dropped (confirmed
  # for BL-131's <ms>) must be threaded to the handler with its Examples column made load-bearing.

  # BL-520 rewrapped-file-passes-without-exemption-01
  Scenario: a rewrapped legacy feature file passes the lint gate with no allowlist entry
    Given a legacy feature file whose wrapped steps have been rejoined to single lines
    And its entry has been removed from the grandfather allowlist
    When the gherkin lint gate runs on it
    Then the gate passes cleanly

  # BL-520 rewrapped-file-acceptance-still-passes-02
  Scenario: the rewrapped file's acceptance run still resolves every step and passes
    Given a rewrapped legacy feature file whose step handlers were reconciled to the full step text
    When its acceptance entry points are generated and run
    Then every scenario resolves to a step handler and the run passes

  # BL-520 dropped-param-restored-on-rewrap-03
  Scenario: a parameter the wrap had dropped is restored and made load-bearing after rewrap
    Given a legacy wrapped step whose continuation line carried a parameter the parser dropped
    When the step is rejoined to a single line and its handler is reconciled
    Then the restored parameter reaches the step handler and its Examples column is referenced

  # BL-520 allowlist-drained-enforces-unconditionally-04
  Scenario: once every legacy file is rewrapped the allowlist is empty and the gate exempts nothing
    Given every legacy feature file has been rewrapped and removed from the allowlist
    Then the allowlist holds no feature-file entries
    And the lint gate enforces single-line steps for every feature file with no exemptions
