Feature: BL-1508 Stamp-off review of the respawn-bootstrap hotfix

  BL-848 review-only certification of landed commit 32fb1ff7e1 (2026-09-09).
  An aider seat's identity arrives only through the post-launch tmux
  bootstrap (/add of the constitution, PIPELINE and role prompt, then the
  composed prompt), which only the launcher's launch_role ran; every
  later respawn re-executed the launch script and stopped, so the new
  aider process began with an empty chat and refused the work it was
  woken for. The hotfix has both respawn drivers - swarm ensure's
  single-role repair and the mono-router rotation - run the launcher's
  own run-bootstrap verb through a new pure lib, fire-and-forget, a no-op
  for embedded providers by construction.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1508 swarm-stamp-respawn-bootstrap-01
  Scenario Outline: a respawned aider seat receives the launcher's own bootstrap
    Given a composed prompt and its compose sidecar for an aider seat
    When <driver> respawns that seat successfully
    Then the run-bootstrap verb is invoked with the same argv order the launcher uses

    Examples:
      | driver                                |
      | swarm ensure's single-role repair     |
      | the mono-router rotation              |

  # BL-1508 swarm-stamp-respawn-bootstrap-02
  Scenario: an embedded-provider seat gets no bootstrap steps
    Given a composed prompt for a claude seat
    When the bootstrap steps for it are derived
    Then there are none

  # BL-1508 swarm-stamp-respawn-bootstrap-03
  Scenario: a missing composed prompt is refused without failing the respawn
    Given an aider seat whose composed prompt is absent
    When swarm ensure's single-role repair respawns it
    Then the bootstrap is refused naming the missing prompt
    And the repair still reports the pane FIXED

  # BL-1508 swarm-stamp-respawn-bootstrap-04
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
