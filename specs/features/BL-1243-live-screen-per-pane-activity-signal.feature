Feature: Each Live Screen tile paints its own agent's activity

  BL-1160 put a status dot inside every role tile and taught the UI to prefer
  an optional per-pane activitySignal. Nothing ever sets that field, so in
  production every dot still paints from whole-poll freshness and all eight
  move together.

  This feature supplies the missing writer, derived from the pane text the
  Live Screen snapshot already holds. It adds no capture and no poll: a design
  that needs new per-pane probes is out of scope and must not ship.

  The mapping is the operator's own, from the source intake: busy paints ok,
  alive-but-idle paints stale, and a pane with no usable text of its own gets
  no signal at all. No fourth status kind is minted.

  Background:
    Given a Live Screen poll that captured pane text for each live role

  # BL-1243 live-screen-per-pane-activity-01
  Scenario: Roles polled together can show different dots
    When one role pane is busy and another is idle in the same poll
    Then their tiles show different activity dots

  # BL-1243 live-screen-per-pane-activity-02
  Scenario Outline: A pane with no usable text of its own is never painted ok
    When a role pane is <condition>
    Then its tile is not painted ok

    Examples:
      | condition      |
      | unavailable    |
      | never captured |

  # BL-1243 live-screen-per-pane-activity-03
  Scenario: The fullscreen cue follows the same pane signal as the tile
    When a role tile is expanded to fullscreen
    Then the fullscreen activity cue shows that pane's own signal

  # BL-1243 live-screen-per-pane-activity-04
  Scenario: The per-tile signal costs no extra capture
    When the snapshot derives an activity signal for every live role
    Then the number of pane captures performed is unchanged

  # BL-1243 live-screen-per-pane-activity-05
  Scenario: The existing colour meanings are not extended
    When a tile paints its activity dot
    Then the dot uses only the status kinds that existed before

  # BL-1243 live-screen-per-pane-activity-06
  # The operator's "never misleading green" during the one event they most need
  # to see. residentSpyUiHtml.ts repaints the LAST snapshot's panes on a failed
  # poll, and the per-pane signal is consulted before anything else - so without
  # this a busy-at-outage tile stays green for the whole outage. Reuses
  # scenario 02's Then; scoped to err only, never to a merely stale aggregate.
  Scenario: A failing poll is never painted healthy by a per-pane signal
    When the poll is failing and a role pane's own last signal was ok
    Then its tile is not painted ok
