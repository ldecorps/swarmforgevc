# mutation-stamp: sha256=dbda866d57bc2a691de5161cdc0cc070261ffa1bb27f829b26281fbfa42034b1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-17T11:19:44.470973Z","feature_name":"Briefing email decides sendability before composing","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-902-briefing-email-composes-before-key-check.feature","background_hash":"d5095b2b45373ddd63d15a0ffcfcc205a322d303dc306a7eb0fb661551c70ee2","implementation_hash":"unknown","scenarios":[{"index":1,"name":"Every undeliverable reason skips before any gathering","scenario_hash":"861f4faef5bd3558ee18ff295c76a7cac3a06505386fab958591e5fcf3425e68","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-17T11:19:44.470973Z"}]}
# acceptance-mutation-manifest-end

Feature: Briefing email decides sendability before composing

  handoffd's per-tick briefing-email sweep must not gather, render, or shell
  out when the mail cannot be delivered. Deciding sendability first turns a
  ~96s stall into a no-op, without changing what is decided.

  Background:
    Given a briefings directory containing one unsent briefing
    And every optional section adapter records whether it was invoked

  # BL-902 briefing-email-composes-before-key-check-01
  Scenario: An undeliverable sweep invokes no section adapter
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the sweep logs that the briefing was skipped for a missing key

  # BL-902 briefing-email-composes-before-key-check-02
  Scenario Outline: Every undeliverable reason skips before any gathering
    Given email delivery is unavailable because <reason>
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the briefing is not marked as sent

    Examples:
      | reason                    |
      | the API key is missing    |
      | email is disabled in conf |

  # BL-902 briefing-email-composes-before-key-check-03
  Scenario: An undeliverable briefing is left to retry, exactly as before
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs
    And the briefing email sweep runs a second time
    Then the briefing is not marked as sent
    And the briefing is still offered to the second sweep

  # BL-902 briefing-email-composes-before-key-check-04
  Scenario: The misconfiguration warning is still logged only once
    Given email delivery is unavailable because the API key is missing
    When the briefing email sweep runs three times
    Then the misconfiguration warning is logged exactly once

  # BL-902 briefing-email-composes-before-key-check-05
  Scenario: A deliverable sweep still composes the briefing in full
    Given email delivery is available
    When the briefing email sweep runs
    Then every section adapter is invoked
    And the briefing is marked as sent exactly once

  # BL-902 briefing-email-composes-before-key-check-06
  Scenario: Undeliverable cost does not grow with the work the briefing describes
    Given email delivery is unavailable because the API key is missing
    And the backlog is large enough that gathering would be expensive
    When the briefing email sweep runs
    Then no section adapter is invoked
    And the sweep performs no shell-out
