Feature: Bubble's Pipeline page shows what is in flight, with a blurb per ticket and its spec one tap away

  The bridge already computes the in-flight board and already serves it to the
  Mini App. This page reuses that read model rather than inventing a second one.
  What is new is the blurb the human sees without tapping anything, and the
  detail sheet that carries a ticket's spec body and its Gherkin.

  Because the human ruled that Bubble's screens ship as remote HTML in the UI
  bundle, these scenarios are bridge-side TypeScript and run in the Node
  acceptance runner. The WebView render on a phone is device surface and is
  BL-829's to verify.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-831 pipeline-page-grid-placement-01
  Scenario: the grid marks each in-flight ticket where the board says it sits
    Given the swarm holds in-flight tickets at different stages
    When the Pipeline page is rendered for Bubble
    Then each in-flight ticket is marked at the agent the board read model reports
    And the page computes no stage placement of its own

  # BL-831 pipeline-page-blurb-present-02
  Scenario: every in-flight ticket carries a blurb on the main view
    Given the swarm holds in-flight tickets at different stages
    When the Pipeline page is rendered for Bubble
    Then each in-flight ticket listed shows its blurb without opening the detail sheet

  # BL-831 pipeline-page-blurb-source-03
  Scenario Outline: the blurb comes from the ticket's own words
    Given an in-flight ticket <ticket state>
    When the Pipeline page is rendered for Bubble
    Then its blurb is <blurb source>

    Examples:
      | ticket state                  | blurb source                             |
      | with a description            | the first sentence of its description    |
      | with no description           | its title                                |

  # BL-831 pipeline-page-detail-sheet-04
  Scenario: tapping a ticket reveals its spec and its scenarios
    Given an in-flight ticket whose acceptance names a feature file that exists
    When its detail is requested from the Pipeline page
    Then the response carries the ticket's spec sections
    And it carries the scenarios of that feature file

  # BL-831 pipeline-page-detail-missing-feature-05
  Scenario: a ticket with no feature file still opens
    Given an in-flight ticket whose acceptance names a feature file that does not exist
    When its detail is requested from the Pipeline page
    Then the response carries the ticket's spec sections
    And it states that no acceptance scenarios are recorded for it

  # BL-831 pipeline-page-empty-state-06
  Scenario: nothing in flight reads as nothing in flight
    Given the swarm holds no in-flight ticket
    When the Pipeline page is rendered for Bubble
    Then the page states that nothing is in flight
    And it does not present the previous grid

  # BL-831 pipeline-page-registered-07
  Scenario: the page is reachable from the pager
    When the served UI bundle manifest is read
    Then it names the Pipeline page as one of its pages
