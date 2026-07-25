Feature: unanswered role questions escalate to the human by email

  # GH-25: operator_runtime.bb tick scans role-awaiting markers; a marker
  # older than the threshold with no prior escalation stamp escalates once
  # via a GitHub mention (GitHub sends the email), then is stamped.

  Background:
    Given an operator runtime with a dedicated ops issue configured

  # GH-25 role-ask-email-escalation-01
  Scenario Outline: escalation fires exactly when active age crosses the threshold and only once
    Given the escalation threshold is <threshold> minutes
    And a role-awaiting marker asked <age> minutes ago with <stamp> escalation stamp
    When the operator runtime tick runs
    Then the escalation outcome is <outcome>

    Examples:
      | threshold | age | stamp | outcome            |
      | 30        | 31  | no    | posted-and-stamped |
      | 30        | 10  | no    | none               |
      | 30        | 90  | prior | none               |
      | 5         | 6   | no    | posted-and-stamped |

  # GH-25 role-ask-email-escalation-02
  Scenario: the escalation posts a GitHub mention and stamps the marker in one pass
    Given the escalation threshold is 30 minutes
    And a role-awaiting marker asked 31 minutes ago with no escalation stamp
    When the operator runtime tick runs
    Then a GitHub mention comment naming the role and question is posted on the ops issue
    And escalated_at_ms is stamped into that marker

  # GH-25 role-ask-email-escalation-03
  Scenario: a question that never reached Telegram still escalates
    Given the escalation threshold is 30 minutes
    And a role-awaiting marker asked 31 minutes ago whose question was never delivered to Telegram
    When the operator runtime tick runs
    Then a GitHub mention comment naming the role and question is posted on the ops issue

  # GH-25 role-ask-email-escalation-04
  Scenario: pending and escalated question state is surfaced in status.json
    Given the escalation threshold is 30 minutes
    And a role-awaiting marker asked 31 minutes ago with no escalation stamp
    When the operator runtime tick runs
    Then status.json reports that role's question as escalated
    And a marker under the threshold is reported in status.json as pending

  # GH-25 role-ask-email-escalation-05
  Scenario: a missing ops issue configuration degrades to a surfaced warning, never a crash
    Given no dedicated ops issue is configured
    And a role-awaiting marker asked 31 minutes ago with no escalation stamp
    When the operator runtime tick runs
    Then the tick completes without error
    And status.json reports the escalation transport as unconfigured
    And the marker is not stamped
