Feature: BL-1418 The Art Director is a real seat: addressable by handoff, listed wherever roles are listed, and booted with its own prompt

  Article 1.10 introduces the Art Director (human directive 2026-09-05).
  A role that exists only as prose cannot be sent a note, has no Telegram
  topic, no mailbox, no worktree and no launch script, and every role list
  in the code base (the topic icon map, the role-topic store, the model
  factory's swarm roles) silently omits it. This feature is that the seat
  exists in every place a role must exist, whichever seat shape the human
  rules (standing pane, on-demand seat, or presentation stage): the shape
  changes the pack's window line and rotation, never these facts.

  Background:
    Given a swarm launched from the full-forge pack with the Art Director declared

  # BL-1418 the-seat-receives-a-note-01
  Scenario: a note addressed to art-director is delivered and received
    When the specifier sends a note to art-director through swarm_handoff.sh
    Then the note lands in the art director's mailbox
    And ready_for_next.sh run as art-director returns that note

  # BL-1418 the-seat-has-a-worktree-and-a-prompt-02
  Scenario: the seat boots in its own worktree with the art-director prompt composed
    When the art director's pane boots
    Then it runs in .worktrees/art-director on its own branch
    And its boot prefix contains swarmforge/roles/art-director.prompt

  # BL-1418 every-role-list-names-it-03
  Scenario Outline: every place that enumerates swarm roles names art-director
    When <registry> is read
    Then it names art-director

    Examples:
      | registry                                   |
      | the role-topic store's swarm roles         |
      | the topic icon map                         |
      | the model factory's swarm roles            |
      | .swarmforge/roles.tsv                      |

  # BL-1418 the-topic-carries-its-own-icon-04
  Scenario: the art director's Telegram topic carries an icon distinct from every other role's
    When the role topics are ensured
    Then a topic exists for art-director
    And its icon collides with no other role topic icon
