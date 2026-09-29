Feature: BL-1811 IO-near code calls the module that owns a domain answer
  Upstream unclebob/swarm-forge adopted a rule on 2026-09-02 (d1e401a): an
  IO-near module never re-walks facts to answer a domain question that a
  higher module already answers; it calls that module and translates the
  result. The prose landed on main at this ticket's mint, in the shared
  engineering article, its detailed reference, and the architect and
  cleaner prompts. This contract keeps it there through later trims. The
  cleaner's existing mutation-site rule already matches upstream's second
  refinement (cc8d63b: never split a one-job module to chase the count),
  and this contract keeps that clause too.

  # BL-1811 shared-article-carries-the-rule-01
  Scenario: the shared engineering article and its detailed reference carry the rule
    When the shared engineering article is read
    Then its Design And Testability section contains "calls the module that owns a domain answer"
    And the detailed engineering reference contains "IO-near modules must not reimplement a domain question" and names "BL-1809"

  # BL-1811 reviewing-roles-carry-the-check-02
  Scenario Outline: the <role> prompt carries the domain-answer check
    When the <role> role prompt is read
    Then it names "BL-1811" and upstream commit "d1e401a"

    Examples:
      | role      |
      | architect |
      | cleaner   |

  # BL-1811 no-split-to-chase-the-count-kept-03
  Scenario: the cleaner's mutation-site rule still refuses a split made only to chase the count
    When the Mutation-Site Size section of the cleaner role prompt is read
    Then it contains "never a mechanical line-count chop" and names upstream commit "cc8d63b"
