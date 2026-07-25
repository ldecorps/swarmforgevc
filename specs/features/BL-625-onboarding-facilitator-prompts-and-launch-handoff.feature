Feature: Onboarding facilitator slice 3 - prompts, launch handoff, and topic reuse

  # BL-625 (BL-590 slice 3). Closes the flow: propose the target's
  # project/engineering prompts via the existing BL-269 CLI
  # (propose-onboarding-prompts.js) committed to the target repo, then the
  # ready-to-launch handoff - the facilitator states the EXACT command the
  # human runs on the target host and never claims to have launched a
  # swarm it cannot reach (human ruling: remit ends at contract agreed +
  # prompts committed + prerequisites verified). One Onboarding topic is
  # REUSED across targets; per-target state keeps concurrent onboardings
  # distinct. Epic swarm-intelligence-layer.

  Background:
    Given a facilitator with a target onboarding in state "contract-agreed"

  # BL-625 prompts-proposed-via-existing-cli-01
  Scenario: the prompts phase runs the existing prompts CLI and commits to the target repo
    When the principal posts the proceed control
    Then the target prompts are proposed via the existing prompts tool
    And the prompt files are committed and pushed to the target repo
    And the state advances to "prompts-proposed"

  # BL-625 ready-to-launch-names-exact-command-02
  Scenario: ready-to-launch states the exact launch command for the target host
    Given the onboarding is in state "gate-open"
    When the facilitator posts the launch handoff
    Then the message names the exact swarm launch command for the target host
    And the message states the human runs it on the target host
    And the state advances to "ready-to-launch"

  # BL-625 never-claims-remote-launch-03
  Scenario: the facilitator never claims to have launched the target swarm
    Given the onboarding is in state "ready-to-launch"
    When the principal asks whether the swarm is running
    Then the facilitator states it cannot launch or observe the target host
    And the facilitator restates the launch command instead

  # BL-625 done-closes-the-onboarding-04
  Scenario: confirming the launch marks the onboarding done
    Given the onboarding is in state "ready-to-launch"
    When the principal confirms the swarm launched on the target host
    Then the state advances to "done"
    And the facilitator posts a completion summary naming the target

  # BL-625 topic-reused-next-target-05
  Scenario: the next onboarding reuses the same topic with its own per-target state
    Given a completed onboarding exists for a previous target
    When the principal posts a new target repo URL in the Onboarding topic
    Then a separate per-target state is persisted for the new URL
    And the previous target's state stays "done"
    And the facilitator's replies name which target they concern
