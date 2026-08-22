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

  An idle pane shows the last ticket THAT PANE ACTED ON - whatever kind of
  item it was, because reaching a pane's completed mailbox means the pane
  worked it. What is excluded is a ticket the pane never handled: an
  abandoned parcel, or an id merely named somewhere else. The purpose is a
  human glancing across windows to see who is doing what.

  The role is not repeated in the title - the status line already renders it
  as the window name, and this writes a separate per-window option so the
  window name and the agent's own pane title are both left alone.

  A title bar is narrow, and narrower still with several windows tiled across
  one screen, so the fields have a drop order: the ticket number survives
  longest, elapsed time next, and the slug shortens and then disappears
  before either. Only a pane with no ticket at all falls back to naming the
  role, because a blank title bar is useless in a window list - a deliberate
  exception, not a contradiction of the rule above it.

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
  Scenario: an idle seat shows the last ticket it acted on
    Given the seat holds no parcel
    And the seat has acted on a ticket before
    When the window title is composed
    Then it names the last ticket the seat acted on
    And the ticket is shown in the not-held form, not the held form

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-03
  Scenario: the most recent item the seat acted on wins, whatever kind it was
    Given the seat holds no parcel
    And the seat handled a parcel for one ticket
    And the seat has since handled a note about a different ticket
    When the window title is composed
    Then it names the ticket the note was about

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-04
  Scenario: a ticket the seat never acted on is never named
    Given the seat holds no parcel
    And the seat handled a parcel for one ticket
    And a different ticket was abandoned without the seat acting on it
    When the window title is composed
    Then it names the last ticket the seat acted on
    And it does not name the abandoned ticket

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-05
  Scenario: a seat that has never acted on a ticket names none
    Given the seat holds no parcel
    And the seat has never acted on a ticket
    When the window title is composed
    Then it names the seat
    And it names no ticket

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-06
  Scenario: a seat holding several parcels names one and counts the rest
    Given the seat holds parcels for more than one ticket
    When the window title is composed
    Then it names one of those tickets
    And it says how many further tickets the seat holds

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-07
  Scenario: two seats of one stage title themselves with their own tickets
    Given a second seat of the same stage running in its own tmux window
    And each seat holds a parcel for a different ticket
    When the window title is composed
    Then each window names the ticket its own seat holds
    And neither names the ticket the other seat holds

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-08
  Scenario Outline: the title drops its least important field first as width shrinks
    Given the seat holds a parcel and has held it for a measurable time
    When the window title is composed for a width of <width>
    Then it shows <fields>
    And the ticket number is never shown partly truncated

    Examples:
      | width       | fields                                    |
      | generous    | ticket number, slug and elapsed           |
      | reduced     | ticket number, shortened slug and elapsed |
      | narrow      | ticket number and elapsed                 |
      | very narrow | ticket number only                        |

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-09
  Scenario: the composed title reaches the terminal's own title bar
    Given the seat holds a parcel
    When the window title is composed
    Then the terminal running that window reports the same title

  # BL-1044 the-terminal-title-names-the-ticket-a-role-holds-10
  Scenario: the window name and the pane title are both left alone
    Given the seat holds a parcel
    And the agent inside the pane rewrites its pane title
    When the window title is composed
    Then the pane title still holds what the agent wrote
    And the window name still names the role, as the status line shows it
    And the composed title names no role
