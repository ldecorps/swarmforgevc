Feature: an always-on headless Linux box runs a secondary swarm unattended

Background:
  Given BL-090 modes, BL-091 bring-up, and BL-092 wake-ups are merged

# BL-101 headless-01
Scenario: provisioning yields a working secondary
  Given a fresh supported host (Pi 5 8GB+SSD, or x86_64 VPS 4GB+)
  When the documented provisioning steps run
  Then the swarm and runner systemd units are enabled and running
  And the box appears as a registered secondary with its own swarm_name

# BL-101 headless-02
Scenario: reboot is loss-free and unattended
  Given the box is mid-parcel when power is lost
  When the box boots again
  Then the swarm relaunches via systemd without human action
  And the in-flight parcel resumes from durable queue state

# BL-101 headless-03
Scenario: outbound-only network posture
  When the provisioned box's listening sockets are inspected
  Then no service beyond SSH accepts inbound connections
  And swarm operation proceeds normally

# BL-101 headless-04
Scenario: repo-scoped credentials only
  When the box's git credential is inspected
  Then it grants access to this repository only
  And no secret exists inside the repo clone

# BL-101 headless-05
Scenario: end-to-end parcel on each reference target
  Given a ticket assigned to the box's swarm
  When the parcel completes its pipeline on that box
  Then the QA-approved merge reaches the shared main from that box
  And this is demonstrated once on ARM64 (Pi) and once on x86_64 (VPS)

# Non-behavioral gates:
#  - Provisioning script logic covered by the swarm-scripts test
#    pattern where testable (conf writing, unit generation); the
#    hardware walkthroughs are documented manual steps.
#  - All substrate installs pinned per the engineering article (no
#    "latest").
