Feature: Each swarm publishes its own rolled-up status and the fleet console merges by enumerating them

# BL-437 (feature, epic BL-435 slice 2): today the fleet console reconstructs each swarm's status from
# the swarm's internal roles.tsv + per-role heartbeat/<role> + handoffd.status.json - a backwards
# coupling. Flip it to BL-242's own principle: the swarm rolls up its OWN pack, the console merges. Each
# swarm publishes ~/.swarmforge/fleet/<swarm_name>/status.json (an enriched heartbeat:
# identity/status/health/children-rollup/needs-human/updated_at), authored by handoffd - the always-on,
# zero-token daemon that survives coordinator death and stays reliably fresh, a natural extension of the
# existing handoffd.status.json ({"state":"healthy","updated_at":...}). The fleet console becomes dumb:
# enumerate the rendezvous dir -> read each status.json -> merge. The roster is "whatever subdirs exist"
# - no hand-maintained registration file (today the console's SwarmRegistration must be authored by
# hand; zero have ever existed). A dead handoffd -> stale updated_at -> the console infers
# "stopped (coordinator lost)" (reusing BL-245's state + watchdog/liveness.ts). needs-human is folded in
# by BL-438; until then it is absent/false.
#
# Scope (verify at build time): swarmforge/scripts/handoffd.bb (write the fleet status.json each cycle),
# extension/src/tools/fleet-console.ts (enumerate the rendezvous dir instead of reconstructing from
# internal files / a hand-authored registration), extension/src/swarm/compositeNode.ts + fleetNode.ts.

Background:
  Given a swarm named "fes" whose handoffd is running

# BL-437 fleet-status-publish-01
Scenario: handoffd publishes a rolled-up status.json each cycle
  When handoffd completes a cycle
  Then it writes ~/.swarmforge/fleet/fes/status.json
  And the doc carries the swarm identity, status, children rollup, and updated_at

# BL-437 fleet-status-publish-02
Scenario: The fleet console renders one swarm per published status.json it finds
  Given the rendezvous dir contains published status.json files for two swarms
  When the fleet console reads the fleet
  Then it renders one swarm per status.json
  And it does not require a hand-maintained registration file

# BL-437 fleet-status-publish-03
Scenario: A swarm with a stale updated_at renders as stopped (coordinator lost)
  Given swarm "fes"'s status.json updated_at is older than the liveness threshold
  When the fleet console reads the fleet
  Then swarm "fes" renders as stopped with coordinator lost

# BL-437 fleet-status-publish-04
Scenario: The console reads the published status purely by field, with no local-only assumptions
  Given a published status.json for swarm "fes"
  When the fleet console renders swarm "fes"
  Then every rendered value is read from a field of the published doc
  And nothing is reconstructed from the swarm's internal role files
