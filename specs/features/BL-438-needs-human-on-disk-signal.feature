Feature: A swarm owns its needs-human state on disk and the fleet console reads it as a field

# BL-438 (feature, epic BL-435 slice 3): closes the isBlocked-always-false gap in
# fleet-console.ts / compositeNode.ts. Today the console can only guess whether a swarm is blocked by
# sniffing pane text; needs-human should be a FIELD the swarm owns. The coordinator/needs-human
# reconciler (the only thing that knows "I'm waiting on a human") writes an on-disk needs-human signal;
# handoffd folds it into the swarm's status.json (BL-437); the fleet console reads isBlocked from that
# field. When the human answers/unblocks, the signal clears.
#
# Scope (verify at build time): the coordinator/needs-human reconciler (write the on-disk signal),
# swarmforge/scripts/handoffd.bb (fold needs-human into status.json), extension/src/tools/fleet-console.ts
# + extension/src/swarm/compositeNode.ts (read isBlocked from the field, not pane text).

Background:
  Given a swarm named "fes" publishing status.json via handoffd

# BL-438 needs-human-on-disk-signal-01
Scenario: When the coordinator is waiting on a human, an on-disk needs-human signal is written
  Given the coordinator is blocked waiting on a human answer
  When the needs-human reconciler runs
  Then an on-disk needs-human signal is written for swarm "fes"

# BL-438 needs-human-on-disk-signal-02
Scenario: handoffd folds the needs-human signal into the swarm's status.json
  Given an on-disk needs-human signal exists for swarm "fes"
  When handoffd completes a cycle
  Then status.json for swarm "fes" reports needs-human true

# BL-438 needs-human-on-disk-signal-03
Scenario: The fleet console reads isBlocked from the status field, not from pane text
  Given status.json for swarm "fes" reports needs-human true
  When the fleet console renders swarm "fes"
  Then it renders swarm "fes" as blocked from the needs-human field
  And it does not sniff pane text to decide blocked

# BL-438 needs-human-on-disk-signal-04
Scenario: When the human answers, the needs-human signal clears and status reflects not-blocked
  Given an on-disk needs-human signal exists for swarm "fes"
  When the human answers and the block is resolved
  Then the needs-human signal clears
  And status.json for swarm "fes" reports needs-human false
