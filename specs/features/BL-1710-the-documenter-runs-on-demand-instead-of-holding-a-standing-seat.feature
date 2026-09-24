Feature: BL-1710 the documenter runs on demand instead of holding a standing seat

  The human ruled on 2026-09-24 that every parcel keeps its documentation
  pass before QA, but the documenter stops being a standing seat: like
  the model steward or the recruiter it is a role that is called. A pack
  window declared on-demand keeps its roles.tsv row, its worktree and its
  mailbox, so routing and every hop are unchanged, but no session is
  started for it at launch. When mail for that role arrives, handoffd
  starts the role's own session through the consult path the closing
  ceremony already uses, and the existing consult teardown sweep ends it
  once it is idle with nothing actionable. full-forge declares its
  documenter on-demand. The scenarios use a fake tmux.

  Background:
    Given a pack whose documenter window is declared on-demand and whose other windows are standing

  # BL-1710 the-documenter-runs-on-demand-01
  Scenario: the launch registers the on-demand documenter but starts no session for it
    When the pack is launched
    Then roles.tsv has a documenter row with its worktree and the on-demand mark
    And no tmux session exists for the documenter while every standing role has one

  # BL-1710 the-documenter-runs-on-demand-02
  Scenario Outline: mail for the on-demand documenter starts its session exactly once
    Given no documenter session exists
    When <mail> for the documenter reaches its inbox and handoffd runs <passes> passes
    Then exactly one documenter session was created, through the consult path, with a consult marker
    And the mail's wake reached that session

    Examples:
      | mail                                           | passes |
      | a git_handoff from the hardender               | 3      |
      | a note from the coordinator asking for a publish | 3      |

  # BL-1710 the-documenter-runs-on-demand-03
  Scenario: an idle on-demand documenter with nothing actionable is torn down
    Given a documenter session started on demand has completed its mail and its inbox is empty
    When handoffd's consult teardown sweep runs
    Then the documenter session is gone and its consult marker is removed

  # BL-1710 the-documenter-runs-on-demand-04
  Scenario: a missing session for an on-demand role raises no alarm
    Given no documenter session exists and its inbox is empty
    When the chase sweep and babysitterd's health pass run
    Then neither reports the documenter's session as missing, stuck or dead

  # BL-1710 the-documenter-runs-on-demand-05
  Scenario: a standing role's missing session is still reported
    Given no coder session exists
    When the chase sweep and babysitterd's health pass run
    Then the coder's missing session is reported exactly as before this ticket
