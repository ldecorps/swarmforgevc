Feature: Onboarding facilitator slice 1 - the Onboarding topic and the prerequisites phase

  # BL-590 slice 1 (of 3: BL-590 topic+prereqs, BL-624 survey->gate,
  # BL-625 prompts+launch handoff). Human-ruled 2026-07-23: build the
  # onboarder for repeatability; it runs on the primary Linux box and
  # onboards from a GitHub URL. Epic swarm-intelligence-layer.
  #
  # This slice ships: the reserved Onboarding topic (ensure-or-reuse like
  # the other standing topics, inbound routed to the facilitator - never
  # the front-desk SUP path), a supervised facilitator poll-loop
  # (negotiation_relay_supervisor.bb shape, registered in
  # start/stop_ancillary_services.sh), a persistent per-target state
  # machine, and the PREREQUISITES phase as guide-and-verify steps:
  # host toolchain, GitHub access, swarmforge fork clone, target repo,
  # and a DEDICATED Telegram bot token (never the primary's - the BL-622
  # one-token-one-poller invariant, guided here at instruction level).
  # A step advances ONLY on a passing pasted verification, never on a
  # bare "done". Survey and everything after it is BL-624; this slice
  # ends at prerequisites-ready.

  Background:
    Given a facilitator bound to the primary group's Onboarding topic with a controllable clock

  # BL-590 onboarding-topic-ensured-and-routed-01
  Scenario: the Onboarding topic is ensured with its own reserved subject and routed to the facilitator
    Given no Onboarding topic exists in the primary group
    When the facilitator service starts
    Then an Onboarding topic is created under its reserved subject id
    And a later start reuses the same topic instead of creating another
    And a principal message in that topic reaches the facilitator
    And it never reaches the front-desk operator path

  # BL-590 new-onboarding-starts-at-prerequisites-02
  Scenario: giving the facilitator a repo URL opens a per-target state at the prerequisites phase
    When the principal posts a target GitHub repo URL in the Onboarding topic
    Then a per-target onboarding state is persisted for that URL
    And the state is "checking-prerequisites"
    And the facilitator posts where the onboarding stands and the first prerequisite instruction

  # BL-590 verification-gates-advancement-03
  Scenario: a prerequisite advances only on a passing pasted verification
    Given the onboarding is on the "toolchain" prerequisite step
    When the principal pastes verification output that passes the step's check
    Then the step is recorded as verified
    And the facilitator posts the next prerequisite instruction

  # BL-590 bare-done-never-advances-04
  Scenario: a bare done claim never advances a prerequisite
    Given the onboarding is on the "toolchain" prerequisite step
    When the principal replies only that the step is done
    Then the step is not recorded as verified
    And the facilitator re-asks for the step's verification command output

  # BL-590 failing-verification-explains-05
  Scenario: a failing verification keeps the step and explains the failure
    Given the onboarding is on the "github-access" prerequisite step
    When the principal pastes verification output that fails the step's check
    Then the step is not recorded as verified
    And the facilitator explains what failed and re-issues the exact instruction

  # BL-590 prerequisites-checklist-coverage-06
  Scenario Outline: every prerequisite step is guided with an instruction and a verification
    Given the onboarding has reached the "<step>" prerequisite step
    When the facilitator posts the step's guidance
    Then the guidance contains the exact command for the target host
    And the guidance names the verification the principal must paste back

    Examples:
      | step          |
      | toolchain     |
      | github-access |
      | fork-clone    |
      | target-repo   |
      | bot-token     |

  # BL-590 dedicated-token-instruction-07
  Scenario: the bot-token step instructs a dedicated new token and forbids reusing the primary's
    Given the onboarding has reached the "bot-token" prerequisite step
    When the facilitator posts the step's guidance
    Then the guidance instructs creating a new bot token for the target
    And the guidance states the primary swarm's token must never be reused

  # BL-590 restart-resumes-mid-flow-08
  Scenario: a facilitator restart resumes the persisted state instead of restarting
    Given the onboarding is on the "fork-clone" prerequisite step with two steps verified
    When the facilitator service restarts
    Then the onboarding resumes at the "fork-clone" step
    And the verified steps stay verified

  # BL-590 pause-and-resume-09
  Scenario: the principal can pause and later resume the onboarding
    Given the onboarding is on the "target-repo" prerequisite step
    When the principal posts the pause control
    Then the facilitator holds and confirms the onboarding is paused
    When the principal posts the proceed control
    Then the facilitator resumes at the same step with the same instruction

  # BL-590 prerequisites-ready-announces-next-10
  Scenario: all prerequisites verified advances to prerequisites-ready and names what comes next
    Given every prerequisite step has a passing verification
    When the last verification is recorded
    Then the state advances to "prerequisites-ready"
    And the facilitator announces the survey phase comes next
