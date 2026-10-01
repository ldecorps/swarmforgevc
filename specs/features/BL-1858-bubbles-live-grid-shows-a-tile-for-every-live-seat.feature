Feature: Bubble's live grid shows a tile for every live seat
  Bubble's live screen draws one tile per seat. It used to take its seats
  from the launch-time session list (.swarmforge/sessions.tsv) alone, but
  only a full launch writes that file. A seat added or swapped later, by
  hand or by `./swarm ensure` reading roles.tsv, never got a row there, so
  it never got a tile, even with its pane alive. On 2026-10-01 the human's
  phone showed eight tiles while ten seats ran: coder@2, the local-model
  seat, and art-director were missing. The live screen now takes every seat
  roles.tsv lists, plus any sessions.tsv seat roles.tsv lacks, and draws one
  tile for each whose tmux session is live. Each tile names the model its
  seat runs under the role name, so the local seat reads as the Qwen coder
  it is.

  Background:
    Given a target swarm whose roles.tsv lists the seats specifier, coder, coder@2, cleaner, architect, hardender, documenter, QA, art-director and coordinator
    And every seat's tmux session is live
    And its sessions.tsv lists every seat except coder@2 and art-director

  # BL-1858 live-grid-tile-per-live-seat-01
  Scenario Outline: A live seat missing from sessions.tsv still gets its own tile
    When the live screen captures its panes
    Then the pane list has a tile for seat "<seat>" labelled "<label>"
    And the tile for seat "<seat>" comes right after the tile for seat "<after>"

    Examples:
      | seat         | label        | after |
      | coder@2      | Coder@2      | coder |
      | art-director | Art Director | QA    |

  # BL-1858 live-grid-tile-per-live-seat-02
  Scenario: Two seats of one role each show the ticket they hold
    Given seat "coder" holds "BL-9001" in its own in_process mailbox
    And seat "coder@2" holds "BL-9002" in its own in_process mailbox
    When the live screen captures its panes
    Then the tile for seat "coder" shows ticket "BL-9001"
    And the tile for seat "coder@2" shows ticket "BL-9002"

  # BL-1858 live-grid-tile-per-live-seat-03
  Scenario: A live session that neither roster lists gets no tile
    Given a live tmux session for the seat coder@iq3, which neither roles.tsv nor sessions.tsv lists
    When the live screen captures its panes
    Then the pane list has no tile for seat "coder@iq3"

  # BL-1858 live-grid-tile-per-live-seat-04
  Scenario: The served page draws every captured seat as a grid tile
    When Bubble's live screen page renders the captured panes
    Then the grid shows 10 tiles
    And one grid tile reads "Coder@2"

  # BL-1858 live-grid-tile-per-live-seat-05
  Scenario Outline: A local-model seat's tile names its qwen model under the role name
    Given coder@2's launch script starts qwen with the model "<model>"
    And a leftover Claude settings file for coder@2 names the model "claude-sonnet-5"
    When Bubble's live screen page renders the captured panes
    Then the tile for seat "coder@2" names the model "<shown>" under its role name

    Examples:
      | model                         | shown             |
      | qwen2.5-coder-14b-q5km:latest | Qwen2.5 Coder 14B |
      | qwen3-coder:30b               | Qwen3 Coder 30B   |
