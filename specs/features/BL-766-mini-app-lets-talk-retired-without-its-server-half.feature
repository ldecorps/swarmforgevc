Feature: Retiring a Let's Talk surface moves its route, its scenarios and its gate together

  A surface is retired as a whole or not at all. While the bridge still answers
  a route, that route's acceptance scenarios must be able to run against it and
  its source must stay inside the quality gates that guard it.

  Background:
    Given a running bridge

  # BL-766 half-retired-01
  Scenario: The Let's Talk route answers what its acceptance scenarios assert
    When the Let's Talk route is requested
    Then the response body is the shape the BL-696 scenarios parse
    And every BL-696 scenario executes rather than erroring on the response

  # BL-766 half-retired-02
  Scenario: The console entry and the route agree on whether the surface exists
    When the console menu is requested
    Then a Let's Talk entry is offered only when the Let's Talk route serves the Mini App page

  # BL-766 gate-scope-03
  Scenario Outline: A source the bridge still serves stays inside the CRAP gate
    Given <source> is reachable through a live bridge route
    When the Let's Talk CRAP gate is run
    Then <source> appears in the gate's report

    Examples:
      | source                              |
      | the Let's Talk Mini App page source |
      | the Let's Talk routes source        |

  # BL-766 gate-scope-04
  Scenario: Removing a source from the gate requires its route to be gone
    Given a source has been dropped from the Let's Talk CRAP gate scope
    When the bridge routes are enumerated
    Then no live route serves that source
