Feature: The terminal title names the ticket its own pane holds

  Six agent windows all title themselves with the same socket path, so
  nothing but the tmux status line distinguishes them, and that names only
  the role. The window name carries the ticket instead - number without the
  BL- prefix, plus a short slug - and tmux's own title option carries it out
  to the terminal's title bar.

  The window name is used rather than the pane title because the agent inside
  the pane already owns the pane title and rewrites it every turn.

  Every title is about ITS OWN PANE. Two seats of one stage work two
  different tickets from two separate mailboxes, so each window titles itself
  with its own - the board's one-column-per-stage view is a different
  question with the opposite answer.

  An idle pane shows the last ticket that PASSED THROUGH it - the last one it
  handled as a parcel, not the last one that got closed and not the last one
  it merely saw named. A role's completed mailbox holds notes as well as
  parcels, and those notes name tickets, so "the newest completed item" gives
  a confident wrong answer.

  Background:
    Given a seat running in its own tmux window, with its own mailbox

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-01
  Scenario Outline: a seat holding a parcel is titled with its ticket
    Given the seat holds a parcel for a ticket whose task name is <task>
    When the window title is composed
    Then it names the seat
    And it names the ticket as <shown>
    And it is no longer than the title budget

    Examples:
      | task                                                | shown              |
      | BL-1035-a-respawned-bot-gets-its-own-startup-grace  | 1035 with a slug   |
      | BL-9-x                                              | 9 with a slug      |

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-02
  Scenario: an idle seat shows the last ticket that passed through it
    Given the seat holds no parcel
    And the seat has handled a parcel before
    When the window title is composed
    Then it names the last ticket that passed through the seat
    And the ticket is shown in the not-held form, not the held form

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-03
  Scenario: a note naming a ticket is not a ticket that passed through
    Given the seat holds no parcel
    And the seat has handled a parcel before
    And the seat has since handled a note that names a different ticket
    When the window title is composed
    Then it names the last ticket that passed through the seat
    And it does not name the ticket the note mentioned

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-04
  Scenario: a seat that has never handled a parcel names no ticket
    Given the seat holds no parcel
    And the seat has never handled a parcel
    When the window title is composed
    Then it names the seat
    And it names no ticket

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-05
  Scenario: two seats of one stage title themselves with their own tickets
    Given a second seat of the same stage running in its own tmux window
    And each seat holds a parcel for a different ticket
    When the window title is composed
    Then each window names the ticket its own seat holds
    And neither names the ticket the other seat holds

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-06
  Scenario: the composed title reaches the terminal's own title bar
    Given the seat holds a parcel
    When the window title is composed
    Then the terminal running that window reports the same title

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-07
  Scenario: the agent's own pane title is left alone
    Given the seat holds a parcel
    And the agent inside the pane rewrites its pane title
    When the window title is composed
    Then the pane title still holds what the agent wrote
    And the window title is unchanged by it
