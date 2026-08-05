Feature: the stuck-in-process check reads owner liveness, and can see every mailbox

  # BL-807: babysitter check 5 (stuck-in-process) is a pure file-age test —
  # `age-min > 30` over `inbox/in_process/*.handoff` — with no liveness input.
  # The same sweep already classifies every pane busy/idle and already threads
  # that into check 10 as `owner-busy?`, so one tick can conclude both "there is
  # motion in this in-process claim" and "this in-process parcel is stuck".
  # Check 5 is also the ONE WARN class that escalates to a pane nudge, so a
  # false positive interrupts a live agent mid-parcel rather than only logging.
  #
  # The same check is blind in the other direction: the master mailbox nests a
  # role segment (`handoffs/<role>/inbox/in_process/`) while worktree mailboxes
  # are flat (`handoffs/inbox/in_process/`). The glob only matches the flat
  # shape, so a genuinely abandoned specifier or coordinator parcel never warns
  # at all. Both directions are one check's correctness and are fixed together.
  #
  # Specifier note: "busy" and "idle" below mean whatever the sweep's existing
  # pane classifier already decides. This ticket consumes that signal; it does
  # not redefine it. The `outcome` column takes exactly two values, `warned`
  # and `suppressed` — a named outcome, not a boolean, so the step handler
  # validates against a known set rather than passing the cell through.

  Background:
    Given a babysitter sweep that classifies each role's pane as busy or idle

  # BL-807 live-owner-suppresses-stuck-warn-01
  Scenario: a long parcel held by a busy owner raises no stuck warning
    Given an in_process parcel older than the stuck threshold
    And its owning role's pane is classified busy
    When the sweep runs
    Then no stuck-in-process warning is raised for that parcel
    And no nudge is sent to that role

  # BL-807 idle-owner-still-warns-02
  Scenario: a long parcel held by an idle owner still raises the warning
    Given an in_process parcel older than the stuck threshold
    And its owning role's pane is classified idle
    When the sweep runs
    Then a stuck-in-process warning is raised for that parcel
    And that warning is eligible to nudge, as it is today

  # BL-807 sweep-never-self-contradicts-03
  Scenario: one sweep never reports motion and stuck for the same parcel
    Given an in_process parcel older than the stuck threshold
    And its owning role's pane is classified busy
    When the sweep runs
    Then the sweep's in-process motion signal and its stuck findings do not disagree about that parcel

  # BL-807 young-parcel-unaffected-04
  Scenario Outline: a parcel below the stuck threshold never warns, whatever the owner is doing
    Given an in_process parcel younger than the stuck threshold
    And its owning role's pane is classified <pane-state>
    When the sweep runs
    Then no stuck-in-process warning is raised for that parcel

    Examples:
      | pane-state |
      | busy       |
      | idle       |

  # BL-807 every-mailbox-shape-is-visible-05
  Scenario Outline: the check sees every mailbox shape, and reads owner liveness for each
    Given an in_process parcel older than the stuck threshold in the <mailbox> mailbox of role <role>
    And that role's pane is classified <pane-state>
    When the sweep runs
    Then the stuck-in-process outcome for that parcel is <outcome>

    Examples:
      | mailbox            | role        | pane-state | outcome    |
      | role-nested master | specifier   | idle       | warned     |
      | role-nested master | coordinator | idle       | warned     |
      | role-nested master | specifier   | busy       | suppressed |
      | flat worktree      | coder       | idle       | warned     |
      | flat worktree      | coder       | busy       | suppressed |

  # BL-807 parcel-counted-once-06
  Scenario: a parcel visible to the widened glob is reported once, not twice
    Given an in_process parcel older than the stuck threshold
    And its owning role's pane is classified idle
    When the sweep runs
    Then exactly one stuck-in-process warning names that parcel
