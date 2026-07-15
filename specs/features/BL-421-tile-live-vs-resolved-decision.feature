Feature: an agent tile marks a decision menu LIVE only while the pane is actually awaiting an answer

  # The Specifier (and every agent) tile shows a host-reconstructed transcript
  # because the Claude CLI's alternate-screen TUI keeps no tmux scrollback
  # (BL-070). A resolved AskUserQuestion decision menu therefore lingers in the
  # transcript, fully rendered with numbered options and a highlighted
  # "Recommended" choice, indistinguishable from a live one — so a human reads
  # long-settled scrollback as an actionable prompt. Liveness is decided against
  # the CURRENT captured frame (never the accumulated transcript), reusing the
  # signal detectNeedsHuman already computes on lastRawText.

  Background:
    Given a decision-menu status is classified from a tile's current captured frame and its reconstructed transcript

  # BL-421 tile-decision-status-01
  Scenario: a decision menu in the current frame is marked LIVE
    Given the pane's current frame is a decision menu still awaiting a human answer
    When the tile's decision status is classified
    Then the menu is marked LIVE and presented as awaiting input

  # BL-421 tile-decision-status-02
  Scenario: a decision menu left behind after the pane is cleared is marked RESOLVED
    Given the pane's current frame is an empty cleared prompt
    And the reconstructed transcript still shows an earlier decision menu
    When the tile's decision status is classified
    Then the menu is marked RESOLVED and not presented as actionable

  # BL-421 tile-decision-status-03
  Scenario: liveness is judged from the current frame, never the transcript
    Given the reconstructed transcript ends with a decision menu identical to a live one
    And the pane's current frame shows the agent producing unrelated later output
    When the tile's decision status is classified
    Then the menu is marked RESOLVED rather than LIVE

  # BL-421 tile-decision-status-04
  Scenario: a tile with no decision menu shows no LIVE or RESOLVED marker
    Given neither the current frame nor the transcript contains a decision menu
    When the tile's decision status is classified
    Then no LIVE or RESOLVED marker is shown
