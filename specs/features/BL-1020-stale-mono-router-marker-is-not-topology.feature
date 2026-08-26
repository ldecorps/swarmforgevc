# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T13:09:25.732345134Z","feature_name":"topology comes from the pack configuration, never from a leftover marker","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1020-stale-mono-router-marker-is-not-topology.feature","background_hash":"80b3c8b94b020597cfd4382b26fd000297ca441f6494b32691116116274c93d9","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: topology comes from the pack configuration, never from a leftover marker

  BL-1020: `.swarmforge/mono-router-active-role` still contained "specifier"
  (mtime 2026-08-19 23:25) on a pack that is NOT a router - full-forge, rotation
  empty. Topology resolution keys off the pack configuration, so the marker
  should be inert, but attach's no-arg resident path still reads it, and a
  leftover file that some paths consult and others ignore is a trap: it reads as
  authority it no longer has.

  Background:
    Given a leftover mono-router-active-role marker naming "specifier"

  # BL-1020 stale-mono-router-marker-is-not-topology-01
  Scenario: on a standing pack the marker does not decide the resident
    Given a pack whose rotation is empty
    When the resident role is resolved
    Then the marker is not consulted as topology
    And the resolution comes from the pack configuration

  # BL-1020 stale-mono-router-marker-is-not-topology-02
  Scenario: on a router pack the marker is still honoured
    Given a pack whose rotation names its roles
    When the resident role is resolved
    Then the resolution honours the marker

  # BL-1020 stale-mono-router-marker-is-not-topology-03
  Scenario: a marker left on a standing pack is surfaced rather than silently obeyed
    Given a pack whose rotation is empty
    When the resident role is resolved
    Then the stale marker is reported as stale
