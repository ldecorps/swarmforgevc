Feature: BL-1412 A text filter on the live Spec-tree console narrows the milestones view to matching tickets

  The live Mini App console's Spec tree (BL-592) is a read-only drill-down
  Milestone -> Epic -> BL item -> Gherkin, served fresh from the bridge. It
  has no way to type a term and see only what matches. The static backlog
  PWA has had exactly that since BL-254: a case-insensitive substring
  filter over a ticket's title, description and scenario text that prunes
  the tree to matching tickets while keeping the hierarchy. The human asked
  for it on the Telegram view on 2026-08-30, in these words: "tip to only
  show entries for which the tree contain that text (classic filter found
  in every IDE tree structure menu)." The ask was lost, resurfaced
  truncated the same day as "...the spec tip text filter...", and was
  pinned to "a Telegram view" on 2026-09-04.

  This feature is that the Spec tree screen carries a filter box behaving
  as the classic IDE tree filter: a ticket is kept when its title,
  description or scenario text contains the term (BL-254's match, reused),
  a milestone, epic or ticket is kept with its whole subtree when its own
  label (name, title or id) contains the term, every kept entry's ancestor
  path stays visible, counts
  follow, clearing restores the full tree, and a term that matches nothing
  says so. All matching is done once, in the bridge. The screen stays
  read-only.

  Background:
    Given the live Mini App console spec tree screen is open over a checkout with tickets in more than one milestone

  # BL-1412 a-term-narrows-the-milestones-view-01
  Scenario Outline: a term narrows the milestones view to the milestone holding the one matching ticket
    Given exactly one ticket matches a term by its <field>
    When the human types that term into the filter box
    Then only that ticket's milestone is listed, with a count of 1
    And drilling into it shows only that ticket's epic and only that ticket

    Examples:
      | field                       |
      | title                       |
      | description                 |
      | scenario text               |
      | title in a different case   |

  # BL-1412 the-term-survives-the-drill-and-the-crumbs-02
  Scenario: the term stays applied while drilling and when returning to Milestones
    Given a term that matches tickets in two milestones
    When the human types the term, opens one milestone, drills into an epic, and returns to Milestones through the crumbs
    Then every level shown along the way listed only matching tickets
    And the Milestones view still lists only those two milestones with their match counts

  # BL-1412 clearing-restores-the-full-tree-03
  Scenario: clearing the filter box restores the full unfiltered tree
    Given a term is applied and the milestones view is narrowed
    When the human clears the filter box
    Then the milestones view lists every milestone with its full count

  # BL-1412 no-match-is-a-clear-empty-state-04
  Scenario: a term that matches no ticket shows a clear empty state naming the term
    When the human types a term that matches no ticket
    Then the content shows a no-results state that names the term rather than a blank page or an error

  # BL-1412 the-bridge-applies-the-one-filter-05
  Scenario: the bridge route serves the filtered tree from the one filter implementation
    When the spec tree state is requested with a query term
    Then the response keeps the unfiltered schema and carries only matching tickets with their pruned hierarchy
    And the same request without a query term returns the full tree

  # BL-1412 a-label-match-keeps-the-subtree-06
  Scenario Outline: a term contained only in an entry's own label keeps that entry with its whole subtree
    Given a term contained only in <label> and in no ticket's text
    When the human types that term into the filter box
    Then that entry is listed with its full count
    And drilling into it shows every ticket beneath it, none hidden

    Examples:
      | label                          |
      | one milestone's name           |
      | one epic tracker's title       |
      | one ticket's id                |
