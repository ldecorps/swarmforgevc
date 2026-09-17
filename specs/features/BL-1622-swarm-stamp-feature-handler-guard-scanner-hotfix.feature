Feature: BL-1622 Stamp-off review of the feature-handler guard scanner hotfix

  BL-848 review-only certification of landed commit bab1f918c8 (2026-09-17,
  human ruling A). QA's whole-branch push 1bcfa2ba45 put BL-1607's step
  handler on main, and its single-quoted '"' literal desynced the old
  two-pass string stripper in featureHandlerRegistrationText.ts, so a later
  double-quoted fixture string carrying a require was read as a real module
  and check_feature_handler_registration.sh refused every direct-to-main
  commit. The hotfix replaces the two passes with one left-to-right scan
  over comments, regex literals and the three quoting forms: comments,
  regex, template and double-quoted literals are blanked, single-quoted
  literals are kept verbatim. These scenarios confirm or refute what
  landed; none may rewrite it, and none writes a certify or waive decision
  into backlog/hotfix-ledger.yaml - only a recorded human decision does.

  # BL-1622 swarm-stamp-feature-handler-guard-scanner-01
  # Census pin (BL-1445): the regression test's name is asserted literally.
  Scenario: the real feature-handler registration unit test file passes and names the regression test
    When the feature-handler registration unit test files run against the compiled tool
    Then they report every test passed and none failed
    And the passing tests include "a single-quoted literal holding a double quote does not unpair the blanking of a later embedded require"

  # BL-1622 swarm-stamp-feature-handler-guard-scanner-02
  Scenario Outline: the scanner names exactly the real requires of a handler text
    Given a handler text in the shape of <shape>
    When its required modules are extracted for a file under specs/pipeline/steps
    Then exactly <modules> are named

    Examples:
      | shape                                                                                  | modules      |
      | a single-quoted double quote followed by a double-quoted string holding a require       | none         |
      | a regex literal holding an apostrophe and one holding a quote class before such a string | none         |
      | a division expression followed by a real require of ./lib/realDep                       | lib/realDep  |
      | a template literal holding a require followed by a real require of ./lib/realDep       | lib/realDep  |
      | a require of ./lib/ghost inside a line comment followed by a real require of ./lib/realDep | lib/realDep |

  # BL-1622 swarm-stamp-feature-handler-guard-scanner-03
  Scenario: the guard is clean on the real tree and still refuses a genuinely missing module
    When the feature-handler registration guard runs against this repository as if on main
    Then it exits 0 and reports no offender
    And the same guard on a fixture tree whose registered handler requires a module the tree lacks reports that module as an offender

  # BL-1622 swarm-stamp-feature-handler-guard-scanner-04
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit carries no human decision
