# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T00:45:16.085299056Z","feature_name":"guarded Telegram control verbs stop, restart, and timed-pause the swarm from the phone","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-423-telegram-swarm-control-verbs.feature","background_hash":"8e5734ad99560bfc2436e566ebe8ae23d3358489626949bbf8af2cb299d4ecd2","implementation_hash":"unknown","scenarios":[{"index":12,"name":"choosing a timed pause duration freezes intake now and schedules auto-resume","scenario_hash":"17ff66deaefaaa4efcbb88650838e77afde4a9dad5d676a06a34397b672f5d7a","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-17T00:44:36.625260398Z"}]}
# acceptance-mutation-manifest-end

Feature: guarded Telegram control verbs stop, restart, and timed-pause the swarm from the phone

  # The authorised human drives the swarm from a dedicated Telegram control topic
  # without opening the VS Code extension: a clean STOP (either drain-and-stop or
  # emergency-stop), a durable RESTART, and a timed PAUSE that freezes new-work
  # intake and auto-resumes on its own (Dropbox-style). Stop and restart reuse the
  # sanctioned bounce path (remote_bounce sentinel + phased bounce-ack), executed by
  # the owning-context executor — never a naive external respawn. Pause freezes
  # intake by driving the same effective active-backlog depth the coordinator already
  # consults before every promotion down to zero — no teardown, agents stay alive.
  # Every verb is guarded to the authorised human and scoped to the control topic;
  # the destructive verbs (stop, restart) are additionally gated behind an explicit
  # confirmation so a single mis-tap cannot tear the swarm down. Inline-button taps
  # (a stop-mode confirm, a pause-duration pick, a resume) re-apply the same
  # principal and topic guards, because anyone in the group can tap another human's
  # button.

  Background:
    Given a dedicated guarded Telegram control topic and the authorised human

  # BL-423 control-restart-confirm-01
  Scenario: an authorised restart verb posts a confirmation and executes nothing yet
    Given the authorised human sends the restart control verb in the control topic
    When the verb is handled
    Then a confirmation prompt is posted and the swarm is left untouched

  # BL-423 control-stop-confirm-modes-02
  Scenario: an authorised stop verb posts a confirmation offering both stop modes
    Given the authorised human sends the stop control verb in the control topic
    When the verb is handled
    Then a confirmation offering a drain-and-stop choice and an emergency-stop choice is posted and the swarm is left untouched

  # BL-423 control-confirm-cancel-03
  Scenario Outline: cancelling a control verb's confirmation leaves the swarm running
    Given the authorised human has a pending "<verb>" confirmation in the control topic
    When the human cancels the confirmation
    Then the swarm is left running and nothing is executed

    Examples:
      | verb    |
      | stop    |
      | restart |

  # BL-423 control-guard-unauthorised-04
  Scenario Outline: an unauthorised sender's control verb is refused with no swarm action
    Given an unauthorised sender posts the "<verb>" control verb in the control topic
    When the verb is handled
    Then it is refused and no swarm control action is taken

    Examples:
      | verb    |
      | stop    |
      | restart |
      | pause   |

  # BL-423 control-guard-topic-05
  Scenario Outline: a control verb outside the control topic is ignored with no swarm action
    Given the authorised human posts the "<verb>" control verb in an ordinary non-control topic
    When the verb is handled
    Then it is ignored and no swarm control action is taken

    Examples:
      | verb    |
      | stop    |
      | restart |
      | pause   |

  # BL-423 control-guard-callback-06
  Scenario: an unauthorised tap on a control button is refused with no swarm action
    Given a pending control button posted by the authorised human in the control topic
    When an unauthorised sender taps that control button
    Then the tap is refused and no swarm control action is taken

  # BL-423 control-stop-emergency-07
  Scenario: a confirmed emergency stop reaps every process immediately with no orphans
    Given the authorised human has confirmed an emergency stop
    When the teardown runs
    Then every swarm-owned process it started is reaped immediately with no drain wait, leaving no orphaned tmux windows or vitest workers

  # BL-423 control-stop-drain-clean-08
  Scenario: a confirmed drain stop waits for in-flight work then reaps every process
    Given the authorised human has confirmed a drain stop and in-flight work finishes within the drain window
    When the teardown runs
    Then it waits for the in-flight work to finish, then reaps every swarm-owned process leaving no orphaned tmux windows or vitest workers, and reports the stop as drained

  # BL-423 control-stop-drain-timeout-09
  Scenario: a drain stop whose work outlasts the drain window forces teardown and reports it
    Given the authorised human has confirmed a drain stop and in-flight work does not finish within the drain window
    When the teardown runs
    Then it forces the teardown after the drain window, reaps every swarm-owned process leaving no orphaned tmux windows or vitest workers, and reports the stop as forced

  # BL-423 control-restart-phases-10
  Scenario: a confirmed restart relaunches from the owning context and reports each phase
    Given the authorised human has confirmed a restart
    When the relaunch runs through the owning-context executor
    Then each bounce phase from draining through done is reported back to the control topic

  # BL-423 control-restart-failed-bootstrap-11
  Scenario: a restart that leaves windows without bootstrapped agents is reported failed
    Given a confirmed restart whose relaunch creates windows but no agent bootstraps into them
    When the relaunch outcome is evaluated
    Then it is reported as failed rather than done

  # BL-423 control-pause-menu-12
  Scenario: an authorised pause verb posts a duration menu and pauses nothing yet
    Given the authorised human sends the pause control verb in the control topic
    When the verb is handled
    Then a pause-duration menu is posted and new-work intake is left running

  # BL-423 control-pause-timed-13
  Scenario Outline: choosing a timed pause duration freezes intake now and schedules auto-resume
    Given the authorised human has a posted pause-duration menu in the control topic
    When the human picks the "<duration>" pause duration
    Then new-work intake is frozen so no paused item is promoted, in-flight parcels keep running, and auto-resume is scheduled after <duration>

    Examples:
      | duration |
      | 15 min   |
      | 1 hr     |
      | 4 hr     |

  # BL-423 control-pause-until-resume-14
  Scenario: choosing pause until resume freezes intake with no timer
    Given the authorised human has a posted pause-duration menu in the control topic
    When the human picks the until-I-resume pause duration
    Then new-work intake is frozen with no auto-resume scheduled, so intake stays frozen until an explicit resume

  # BL-423 control-pause-autoresume-15
  Scenario: a timed pause auto-resumes when its duration elapses and reports it
    Given a timed pause whose duration has elapsed
    When the pause is evaluated on the sweep
    Then new-work intake is automatically restored and the resume is reported to the control topic

  # BL-423 control-resume-now-16
  Scenario: an authorised resume restores intake immediately before any timer elapses
    Given the swarm is paused with intake frozen
    When the authorised human resumes from the control topic
    Then new-work intake is restored immediately and no auto-resume timer remains pending
