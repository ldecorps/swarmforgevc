Feature: the Bubble Control page - drive the swarm from the phone

  Expanding the Bubble lands on Let's Talk. A swipe reaches Control, where the
  human can start the swarm, drain-stop it, emergency-stop it, put it on holiday
  quiet and pick which shift is staffed - the same verbs the Telegram Control
  topic already offers, rendered as a remote HTML page in the UI bundle.

  Background:
    Given the Bubble shell renders the remote UI bundle
    And the bundle names a page "control"
    And the bridge reports the swarm running with no holiday quiet and the "Day" shift active

  # BL-843 bubble-control-page-01
  Scenario: expanding lands on Talk, and Control is a swipe away
    When the human expands the Bubble
    Then the page shown is the native Talk page
    And the pager can reach the "control" page by swiping

  # BL-843 bubble-control-page-02
  Scenario: the status line says what the bridge just reported
    When the human opens the "control" page
    Then the status line reads "Swarm running · Day shift"

  # BL-843 bubble-control-page-03
  Scenario Outline: a teardown verb takes two taps, and one tap changes nothing
    Given the human is on the "control" page
    When the human taps "<verb>" once
    Then no control request is sent
    And the page asks for confirmation of "<verb>"

    Examples:
      | verb           |
      | Drain & stop   |
      | Emergency stop |

  # BL-843 bubble-control-page-04
  Scenario: confirming sends the verb and the status line follows the result
    Given the human is on the "control" page
    And the human has tapped "Emergency stop" once
    When the human confirms
    Then a control request for "emergency-stop" is sent
    And the status line reads what the bridge reports after the action

  # BL-843 bubble-control-page-05
  Scenario: Start is muted while the swarm runs, and says why when tapped
    Given the human is on the "control" page
    When the human taps "Start"
    Then the page shows the reason the bridge gave
    And the reason names that the swarm is already running

  # BL-843 bubble-control-page-06
  Scenario: holiday quiet disables the shift picks while it is on
    Given the human is on the "control" page
    When the human turns "Holiday" on
    Then the shift picks are shown as unavailable
    And the status line reads "Holiday quiet"

  # BL-843 bubble-control-page-07
  Scenario Outline: exactly one shift is shown selected when holiday quiet is off
    Given the human is on the "control" page
    When the human taps the "<picked>" shift
    Then the only shift shown as selected is "<picked>"
    And the status line reads "Swarm running · <picked> shift"

    Examples:
      | picked  |
      | Day     |
      | Evening |
      | Night   |

  # BL-843 bubble-control-page-08
  Scenario Outline: the page never goes blank or spins forever
    Given the human is on the "control" page
    When the bridge <bridge behaviour>
    Then the page shows an unavailable state naming its reason
    And no control verb is offered as tappable

    Examples:
      | bridge behaviour           |
      | cannot be reached          |
      | refuses the status request |
