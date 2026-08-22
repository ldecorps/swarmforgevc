Feature: provider-outage evidence reaches the flow-watchdog in production

  BL-650 built the active-time clock's provider-outage subtraction and left the
  adapter that feeds it optional. handoffd's flow-watchdog sweep - the only real
  production caller - never supplies it, so no parcel has ever had a single
  millisecond of provider outage subtracted. This feature closes that: the daemon
  records the provider-unavailability it already sees on live panes, and the
  sweep reads it back.

  Background:
    Given the daemon observes each live role's pane on every chase sweep
    And role "coder" runs provider "anthropic"
    And the availability ledger contributes no intervals over the spans below

  # BL-840 provider-outage-evidence-reaches-flow-watchdog-01
  Scenario: unavailability seen on a live pane becomes durable evidence
    Given no provider-outage evidence has been recorded for role "coder"
    When the daemon observes role "coder"'s pane showing "API Error: 529 overloaded_error"
    Then one provider-outage evidence line is recorded for provider "anthropic"
    And the recorded line carries the observation timestamp and the observed text

  # BL-840 provider-outage-evidence-reaches-flow-watchdog-02
  Scenario Outline: only unavailability-class pane text is recorded as an outage
    Given no provider-outage evidence has been recorded for role "coder"
    When the daemon observes role "coder"'s pane showing "<pane text>"
    Then the number of evidence lines recorded is <lines>

    Examples:
      | pane text                            | lines |
      | API Error: 529 overloaded_error      | 1     |
      | 429 Too Many Requests                | 1     |
      | 503 Service Unavailable              | 1     |
      | AuthenticationError: invalid api key | 0     |
      | request timed out                    | 0     |
      | npm run compile finished             | 0     |

  # BL-840 provider-outage-evidence-reaches-flow-watchdog-03
  Scenario Outline: a standing banner is recorded at most once per observation interval
    Given the configured observation interval is 60 seconds
    And role "coder" recorded a provider-outage evidence line at "2026-08-07T10:00:00Z"
    When the daemon observes the same banner on that pane at "<observed at>"
    Then the number of further evidence lines recorded is <further lines>

    Examples:
      | observed at          | further lines |
      | 2026-08-07T10:00:30Z | 0             |
      | 2026-08-07T10:02:00Z | 1             |

  # BL-840 provider-outage-evidence-reaches-flow-watchdog-04
  Scenario Outline: what the sweep subtracts depends on what evidence it can read
    Given a parcel enqueued at "2026-08-07T09:00:00Z" aging in role "coder"
    And the provider-outage evidence store <evidence state>
    When the flow-watchdog sweeps at "2026-08-07T10:00:00Z"
    Then the parcel's wall age is 60 minutes
    And its effective age is <effective minutes> minutes
    And the sweep completes without error

    Examples:
      | evidence state                                                                   | effective minutes |
      | holds an "anthropic" outage from "2026-08-07T09:10:00Z" to "2026-08-07T09:40:00Z" | 30                |
      | holds no lines at all                                                            | 60                |
      | does not exist                                                                   | 60                |
      | is corrupt and cannot be parsed                                                  | 60                |

  # BL-840 provider-outage-evidence-reaches-flow-watchdog-05
  Scenario Outline: an outage is attributed to the provider, never to the pane it was seen on
    Given a parcel enqueued at "2026-08-07T09:00:00Z" aging in role "<role>"
    And role "<role>" runs provider "<role provider>"
    And provider-outage evidence observed on role "coder"'s pane for provider "anthropic" spanning "2026-08-07T09:10:00Z" to "2026-08-07T09:40:00Z"
    When the flow-watchdog sweeps at "2026-08-07T10:00:00Z"
    Then its effective age is <effective minutes> minutes

    Examples:
      | role    | role provider | effective minutes |
      | coder   | anthropic     | 30                |
      | cleaner | anthropic     | 30                |
      | cleaner | openrouter    | 60                |
