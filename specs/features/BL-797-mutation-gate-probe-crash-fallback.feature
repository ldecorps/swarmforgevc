Feature: Mutation cooldown gate survives missing host probes

  The gate reads host cores and load through shell probes (nproc, sysctl,
  uptime). babashka's process/sh throws when a probe binary is absent, so on
  macOS (which has no nproc) the gate crashed outright instead of reaching its
  own documented fallbacks. These scenarios pin the fallback chain: a missing
  probe degrades to the next probe or default, never a crash. They drive the
  real gate script with stub probes on a controlled PATH — no dependence on
  the test host's real core count or load.

  Background:
    Given a project root with a mutation cooldown conf
    And a controlled PATH of stub host probes

  # BL-797 mutation-gate-probe-crash-fallback-01
  Scenario: A missing nproc falls back to sysctl
    Given "nproc" is absent from the PATH
    And a stub "sysctl" reporting 8 cores
    When the mutation cooldown gate runs
    Then it exits successfully with a gate decision
    And it reports 8 cores

  # BL-797 mutation-gate-probe-crash-fallback-02
  Scenario: Missing nproc and sysctl fall back to the default core count
    Given "nproc" and "sysctl" are both absent from the PATH
    When the mutation cooldown gate runs
    Then it exits successfully with a gate decision
    And it reports 4 cores

  # BL-797 mutation-gate-probe-crash-fallback-03
  Scenario: A missing uptime probe degrades to an idle load reading
    Given "uptime" is absent from the PATH
    When the mutation cooldown gate runs
    Then it exits successfully with a gate decision
    And it reports an idle load average

  # BL-797 mutation-gate-probe-crash-fallback-04
  Scenario: The forced core count seam bypasses the probes entirely
    Given the core probe is forced to 16 cores
    And "nproc" and "sysctl" are both absent from the PATH
    When the mutation cooldown gate runs
    Then it exits successfully with a gate decision
    And it reports 16 cores
