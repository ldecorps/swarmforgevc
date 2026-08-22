Feature: one control plane - the bridge drives swarm control verbs the phone can call

  The Telegram Control topic already starts, drain-stops, emergency-stops, sets
  holiday quiet and picks a shift, through functions in the extension host. The
  phone has no way to call any of them. This feature puts those same functions
  behind bridge endpoints with a confirm discipline, so a second control plane is
  never invented - and so every refusal arrives with a reason a human can read.

  Background:
    Given the bridge is reachable and the caller is authenticated
    And the swarm is running with no holiday quiet and no active shift

  # BL-842 bridge-swarm-control-verbs-01
  Scenario: the control status says what is true right now
    When the caller reads the control status
    Then it reports the swarm as running
    And it reports no holiday quiet
    And it reports no active shift

  # BL-842 bridge-swarm-control-verbs-02
  Scenario Outline: a verb that tears the swarm down does nothing without a confirm
    When the caller submits "<verb>" with no confirmation
    Then the request is refused
    And the refusal states its reason
    And the swarm is still running

    Examples:
      | verb            |
      | drain-and-stop  |
      | emergency-stop  |

  # BL-842 bridge-swarm-control-verbs-03
  Scenario Outline: a confirmed teardown verb reaches the existing control function
    Given the caller holds a confirmation issued for "<verb>"
    When the caller submits "<verb>" with that confirmation
    Then the request is accepted
    And the swarm stop mode requested is "<stop mode>"

    Examples:
      | verb           | stop mode |
      | drain-and-stop | drain     |
      | emergency-stop | emergency |

  # BL-842 bridge-swarm-control-verbs-04
  Scenario: a confirmation issued for one verb does not authorise another
    Given the caller holds a confirmation issued for "drain-and-stop"
    When the caller submits "emergency-stop" with that confirmation
    Then the request is refused
    And the refusal states its reason
    And the swarm is still running

  # BL-842 bridge-swarm-control-verbs-05
  Scenario: a confirmation cannot be spent twice
    Given the caller holds a confirmation issued for "drain-and-stop"
    And the caller has already spent that confirmation
    When the caller submits "drain-and-stop" with that confirmation
    Then the request is refused
    And the refusal states its reason

  # BL-842 bridge-swarm-control-verbs-06
  Scenario: starting a swarm that is already running is refused, and says so
    When the caller submits "start" with no confirmation
    Then the request is refused
    And the refusal states its reason
    And the reason names that the swarm is already running

  # BL-842 bridge-swarm-control-verbs-07
  Scenario: holiday quiet refuses a shift pick out loud rather than ignoring it
    Given holiday quiet is on
    When the caller submits a shift pick of "Day"
    Then the request is refused
    And the refusal states its reason
    And there is still no active shift

  # BL-842 bridge-swarm-control-verbs-08
  Scenario Outline: picking a shift replaces whichever one was staffed before
    Given the active shift is "<first>"
    When the caller submits a shift pick of "<second>"
    Then the request is accepted
    And exactly one shift is active, and it is "<second>"

    Examples:
      | first   | second  |
      | Day     | Evening |
      | Evening | Night   |
      | Night   | Day     |

  # BL-842 bridge-swarm-control-verbs-09
  Scenario: turning holiday quiet off restores the shift that was picked before it
    Given the active shift is "Evening"
    And holiday quiet is on
    When the caller turns holiday quiet off
    Then the request is accepted
    And exactly one shift is active, and it is "Evening"
