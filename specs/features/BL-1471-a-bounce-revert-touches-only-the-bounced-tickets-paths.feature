Feature: BL-1471 A bounce revert touches only the bounced ticket's paths, and an omission bounce reverts nothing

  The bounce rule (BL-490/BL-495) tells a reviewing role to revert the
  bounced content out of its own branch. A git revert of the review merge
  reverses that merge's whole diff relative to the branch's prior tip, so
  when the branch had not independently taken the parcel's earlier,
  reviewed content, the revert strips that content and every other
  ticket's file that arrived through the same history. And a bounce for an
  omission, a spec gap or a missing test or doc, names nothing the parcel
  added wrongly, so there is nothing to revert at all. On 2026-09-07 QA
  bounced BL-1348 for a missing scenario and reverted the documenter merge
  wholesale: ruling B's implementation, its tests, both vitest configs and
  two other tickets' evidence files left the QA branch, and only the coder
  restoring them on merge stopped a silent regression. This feature is a
  commit-time guard in the shared chain: a revert commit that touches a
  path attributed to another ticket is refused naming it, and a revert
  made for an omission-class bounce is refused as having nothing to
  revert. Every scenario runs against a fixture repository under mkdtemp
  with its own bounce store (BL-1390).

  Background:
    Given a fixture repository with a reviewing branch that merged a parcel for one ticket, a bounce store under the fixture root, and the shared commit-guard chain

  # BL-1471 a-revert-scoped-to-the-bounced-tickets-paths-passes-01
  Scenario: a revert whose diff touches only the bounced ticket's own paths passes
    Given the ticket's latest bounce record is of a wrong-content class
    And a staged revert of the review merge whose diff touches only paths attributed to the bounced ticket
    When the commit-guard chain judges the revert
    Then the revert-scope guard passes

  # BL-1471 a-revert-removing-another-tickets-path-is-refused-02
  Scenario: a revert that removes a path attributed to another ticket is refused naming the path and the ticket
    Given the ticket's latest bounce record is of a wrong-content class
    And a staged revert of the review merge whose diff removes a path attributed to a different ticket
    When the commit-guard chain judges the revert
    Then the revert-scope guard refuses, naming that path and the ticket it belongs to

  # BL-1471 an-omission-bounce-revert-is-refused-03
  Scenario Outline: a revert made for an omission-class bounce is refused as having nothing to revert
    Given the ticket's latest bounce record is of class <class>
    And a staged revert of the review merge
    When the commit-guard chain judges the revert
    Then the revert-scope guard refuses, saying an omission bounce reverts nothing

    Examples:
      | class               |
      | spec-gap            |
      | invariant-unencoded |

  # BL-1471 a-non-revert-commit-is-not-judged-04
  Scenario: a commit that is not a revert is not judged by the guard
    Given a staged ordinary commit on the reviewing branch
    When the commit-guard chain judges it
    Then the revert-scope guard exits without judging

  # BL-1471 the-guard-runs-from-the-shared-chain-05
  Scenario: the guard runs from the shared commit-guard chain
    When the commit-guard runner is inspected
    Then it runs the revert-scope guard in its cheap tier
