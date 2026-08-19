Feature: A document the constitution cites as authority exists on main

  Constitution articles cite documents by path as the normative authority for a
  rule. An agent following such a rule reads the cited path out of its own
  worktree, which is a checkout of main. A citation that resolves only on an
  unmerged branch is unreadable to every agent, and the rule it backs becomes
  folklore.

  Background:
    Given the constitution articles tracked on main

  # BL-945 constitution-doc-citations-resolve-01
  Scenario: every document path cited by a constitution article resolves on main
    When the article files are scanned for cited document paths
    Then every cited path exists on main

  # BL-945 constitution-doc-citations-resolve-02
  Scenario: a citation that resolves only on an unmerged branch is reported
    Given an article citing a document present on a branch but absent from main
    When the citation check runs
    Then the check fails
    And it names the citing article and the unresolved path

  # BL-945 constitution-doc-citations-resolve-03
  Scenario Outline: a reference that is not a repo document path is not reported
    Given an article citing "<citation>"
    When the citation check runs
    Then the check does not report it

    Examples:
      | citation                        |
      | https://example.com/spec        |
      | another article by article name |
