Feature: a Cursor identity is certified on evidence before production routing

  BL-1079: the Model Steward already owns the certification gate, and BL-525
  already proves it holds — ModelFactory filters every role candidate through
  `assignment-eligible?`, so a candidate is excluded from `assign` and
  `cold-apply` unless `--override-uncertified` is passed, and the rationale
  records the override when one is used. Those scenarios are not restated
  here; this slice supplies the Cursor identity that gate has never had.

  Two things must be true before that identity is routable, and neither is
  today. First, it must be keyed on its own provider. The Cursor CLI serves
  models under borrowed vendor names, so registering it as an `anthropic/…`
  id would make a Cursor seat indistinguishable from a first-party Anthropic
  one for routing, cost attribution and the compliance record. Second,
  certification must mean something: `certify` builds its report from an empty
  result set, so any identity can be certified with no evidence at all, and a
  gate that certifies on nothing gates nothing.

  The compliance battery already emits per-check scorecard entries and
  aggregates them (`compliance_battery.bb scorecard`). This slice makes that
  aggregate the evidence `certify` requires, registers the Cursor identity as
  a reachable candidate, and pins the one cross-boundary agreement no import
  can check: the agent token ModelFactory derives from a provider has to be a
  token the shell launcher's allow-list accepts (BL-1078).

  The seeded identity stays a candidate. Certification is an operator act on
  evidence, never a seed default — BL-1078's scenarios hold an uncertified
  Cursor identity fixed and stay true beside these.

  Background:
    Given the steward registry built from the committed model steward seed

  # BL-1079 cursor-identity-steward-certified-01
  Scenario: the Cursor identity is registered under its own provider
    When the Cursor identity is looked up in that registry
    Then it is present with status candidate
    And its provider is cursor rather than a borrowed vendor name
    And no anthropic identity was added or altered by the seed change

  # BL-1079 cursor-identity-steward-certified-02
  Scenario: the Cursor identity is reachable as a role candidate, not inert
    When role candidates for role documenter are listed including uncertified ones
    Then the Cursor identity is among them
    And it carries a capability entry and a production adapter entry

  # BL-1079 cursor-identity-steward-certified-03
  Scenario Outline: certify decides on compliance-battery evidence
    Given a compliance battery scorecard for the Cursor identity that is <evidence>
    When certify is run for that identity
    Then its status is <status>
    And its recorded certification report <report>
    And the command output names the scorecard artifact by path

    Examples:
      | evidence | status    | report                      |
      | absent   | candidate | is unchanged                |
      | present  | certified | names the scorecard it read |

  # BL-1079 cursor-identity-steward-certified-04
  Scenario: the agent token derived for Cursor is one the launcher accepts
    When the agent token ModelFactory derives for provider cursor is resolved
    And the shell launcher's agent allow-list is read from its own source
    Then that token appears in that allow-list
    And the two literals are compared rather than restated in a comment
