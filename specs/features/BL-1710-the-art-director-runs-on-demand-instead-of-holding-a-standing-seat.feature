Feature: BL-1710 the art director runs on demand instead of holding a standing seat

  The human, 2026-09-23, corrected on 2026-09-24 to name the Art Director:
  it does not need to be a seat, more a role, called by any agent that
  needs to publish something, typically the documenter. The Art Director
  is outside the pipeline chain already (Article 1.10); what changes is
  that it stops holding a standing session. A pack window declared
  on-demand keeps its roles.tsv row, worktree and mailbox, so every note
  it sends and receives is unchanged, but no session is started for it at
  launch. When mail for that role arrives - QA's sign-off note, a review
  call from the documenter or any other role - handoffd starts the role's
  own session through the consult path, and the existing consult teardown
  sweep ends it once it is idle with nothing actionable. full-forge
  declares its art-director window on-demand. The scenarios use a fake
  tmux.

  Background:
    Given a pack whose art-director window is declared on-demand and whose other windows are standing

  # BL-1710 the-art-director-runs-on-demand-01
  Scenario: the launch registers the on-demand art director but starts no session for it
    When the pack is launched
    Then roles.tsv has an art-director row with its worktree and the on-demand mark
    And no tmux session exists for the art-director while every standing role has one

  # BL-1710 the-art-director-runs-on-demand-02
  Scenario Outline: mail for the on-demand art director starts its session exactly once
    Given no art-director session exists
    When <mail> for the art-director reaches its inbox and handoffd runs <passes> passes
    Then exactly one art-director session was created, through the consult path, with a consult marker
    And the mail's wake reached that session

    Examples:
      | mail                                               | passes |
      | a sign-off note from QA                            | 3      |
      | a review call note from the documenter             | 3      |

  # BL-1710 the-art-director-runs-on-demand-03
  Scenario: an idle on-demand art director with nothing actionable is torn down
    Given an art-director session started on demand has completed its mail and its inbox is empty
    When handoffd's consult teardown sweep runs
    Then the art-director session is gone and its consult marker is removed

  # BL-1710 the-art-director-runs-on-demand-04
  Scenario: a missing session for an on-demand role raises no alarm
    Given no art-director session exists and its inbox is empty
    When the chase sweep and babysitterd's health pass run
    Then neither reports the art-director's session as missing, stuck or dead

  # BL-1710 the-art-director-runs-on-demand-05
  Scenario: a standing role's missing session is still reported
    Given no coder session exists
    When the chase sweep and babysitterd's health pass run
    Then the coder's missing session is reported exactly as before this ticket
