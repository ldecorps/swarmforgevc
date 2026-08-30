Feature: A tracked launcher never names a pack the repo does not carry

  start-swarm-qwen.sh is tracked and launches SWARMFORGE_PACK
  qwen-anthropic-forge, but swarmforge/packs/qwen-anthropic-forge.conf has
  never been committed - no commit in any ref or reflog contains it. The pack
  works only on this one machine, by accident of an uncommitted working-tree
  file, and a fresh clone or a git clean silently removes the config while
  leaving the launcher that needs it.

  The gate is over the repo as committed, so it fails on exactly the shape
  that is live today and passes once the config is either committed or the
  launcher stops naming it.

  Background:
    Given the repository as committed, with no untracked files consulted

  # BL-1286 tracked-launcher-named-pack-01
  Scenario: A pack named by tracked code must itself be tracked
    When a tracked launcher names a swarm pack
    Then that pack's config file is present in the repository

  # BL-1286 tracked-launcher-named-pack-02
  Scenario: The gate reports the offending pair, not just a count
    When a tracked launcher names a pack the repository does not carry
    Then the report names both the launcher and the missing pack file

  # BL-1286 tracked-launcher-named-pack-03
  # An untracked file on one developer's disk must never satisfy the gate -
  # that working-tree copy is the very thing that hid the defect.
  Scenario: An untracked config on disk does not satisfy the gate
    When the missing pack config exists only as an untracked working-tree file
    Then the gate still reports it as missing
