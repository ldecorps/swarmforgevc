Feature: The terminal title names the ticket a role holds

  Six agent windows all title themselves with the same socket path, so
  nothing but the tmux status line distinguishes them, and that names only
  the role. The window name carries the ticket instead - number without the
  BL- prefix, plus a short slug - and tmux's own title option carries it out
  to the terminal's title bar.

  The window name is used rather than the pane title because the agent inside
  the pane already owns the pane title and rewrites it every turn.

  Background:
    Given a role running in its own tmux window

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-01
  Scenario Outline: a role holding a parcel is titled with its ticket
    Given the role holds a parcel for a ticket whose task name is <task>
    When the window title is composed
    Then it names the role
    And it names the ticket as <shown>
    And it is no longer than the title budget

    Examples:
      | task                                                | shown              |
      | BL-1035-a-respawned-bot-gets-its-own-startup-grace  | 1035 with a slug   |
      | BL-9-x                                              | 9 with a slug      |

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-02
  Scenario: an idle role shows the last ticket it cleared, marked as cleared
    Given the role holds no parcel
    And the role has cleared a ticket before
    When the window title is composed
    Then it names the last ticket the role cleared
    And the ticket is shown in the cleared form, not the held form

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-03
  Scenario: a role that has never held a parcel names no ticket
    Given the role holds no parcel
    And the role has never cleared a ticket
    When the window title is composed
    Then it names the role
    And it names no ticket

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-04
  Scenario: the composed title reaches the terminal's own title bar
    Given the role holds a parcel
    When the window title is composed
    Then the terminal running that window reports the same title

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-05
  Scenario: the agent's own pane title is left alone
    Given the role holds a parcel
    And the agent inside the pane rewrites its pane title
    When the window title is composed
    Then the pane title still holds what the agent wrote
    And the window title is unchanged by it
