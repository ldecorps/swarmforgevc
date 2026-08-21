Feature: The Boy Scout scan ranks technical debt by what it keeps costing

  Debt that costs once is just debt. Debt that costs again and again is what
  the operator experiences as annoying, so recurrence - not severity, not
  size, and never a judgement call made fresh each run - is this scan's rank
  key. An item that has already shown up in three independent evidence
  sources outranks a nastier-looking one that has shown up once.

  The scan is read-only and deterministic: it reads sources that already
  exist and writes nothing but its own report, so the same repository state
  always produces the same ranking and a human can check any rank without
  re-running it.

  Background:
    Given a Boy Scout scan over a repository

  # BL-1014 boy-scout-scan-01
  Scenario: an item that has cost time repeatedly outranks one that cost time once
    Given a debt item "A" attested by 1 evidence source
    And a debt item "B" attested by 3 evidence sources
    When the scan ranks the inventory
    Then "B" ranks above "A"

  # BL-1014 boy-scout-scan-02
  Scenario Outline: every named evidence source contributes to the inventory
    Given the repository carries a debt signal of kind <source>
    When the scan ranks the inventory
    Then the inventory contains an item derived from <source>

    Examples:
      | source                  |
      | deferred-hardening-gate |
      | bounce-recurrence       |
      | crap-over-threshold     |
      | duplication             |
      | runtime-bloat           |

  # BL-1014 boy-scout-scan-03
  Scenario: every ranked item names the artifact its rank came from
    Given the repository carries a deferred hardening gate for one file
    When the scan ranks the inventory
    Then that item names the evidence artifact it was derived from
    And that artifact is readable without re-running the scan

  # BL-1014 boy-scout-scan-04
  Scenario: two scans of one repository state produce one ranking
    Given a fixed repository state
    When the scan runs twice
    Then both runs produce an identical ranking

  # BL-1014 boy-scout-scan-05
  Scenario: the scan mutates nothing but its own report
    Given a fixed repository state
    When the scan runs
    Then no file outside the report output has changed

  # BL-1014 boy-scout-scan-06
  Scenario: a clean repository reports which sources were consulted
    Given the repository carries no debt signal in any source
    When the scan ranks the inventory
    Then the report names every source it consulted
    And the report states that each one was found clean
