Feature: BL-2101 The Article drafts page shows the Art Director's episode drafts

  The Art Director writes each LinkedIn episode as a
  DRAFT-linkedin-*.md file in the master checkout's .swarmforge/operator/,
  a meta block above the first "---" line and the post below it, and
  never commits one (art-director.prompt, 2026-10-09). This feature is the
  live Mini App page where the human reads those drafts: an index of the
  drafts, newest first, and a page per draft showing only the post. Built
  on 2026-10-09 by a Cursor agent and left uncommitted in the master
  checkout; this ticket lands it through the pipeline.

  Background:
    Given the operator directory holds the draft "DRAFT-linkedin-s1e1-first-20261001.md" saved first
    And the operator directory holds the draft "DRAFT-linkedin-s1e2-second-20261009.md" saved second
    And the operator directory holds the note "NOTE-linkedin-series.md"

  # BL-2101 article-drafts-page-01
  Scenario: the index lists only LinkedIn drafts, newest first
    When the article drafts index is built
    Then it lists "DRAFT-linkedin-s1e2-second-20261009.md" then "DRAFT-linkedin-s1e1-first-20261001.md"
    And it does not list "NOTE-linkedin-series.md"

  # BL-2101 article-drafts-page-02
  Scenario: a draft's page shows the post and not its meta block
    Given the draft "DRAFT-linkedin-s1e2-second-20261009.md" has the meta line "Saved for review, not posted." above its first "---" line and the line "Second episode" below it
    When the page for the draft "DRAFT-linkedin-s1e2-second-20261009.md" is built
    Then its title is "Second episode"
    And its page does not contain "Saved for review, not posted."

  # BL-2101 article-drafts-page-03
  Scenario Outline: a page request that names anything but a draft in the operator directory is refused
    When the page for the draft "<file>" is built
    Then it is refused with "<error>"

    Examples:
      | file                               | error              |
      | ../secret.md                       | invalid draft file |
      | NOTE-linkedin-series.md            | invalid draft file |
      | DRAFT-linkedin-missing-20261009.md | draft not found    |

  # BL-2101 article-drafts-page-04
  Scenario: the bridge links the page and serves its feeds only to a token holder
    When the bridge is started on the operator directory's project
    Then the console menu links "/article-drafts"
    And the Mini App page bundle lists the page "article-drafts"
    And "/article-drafts-index" answers the draft list to a request carrying the bridge token
    And "/article-drafts-index" refuses a request without the bridge token
