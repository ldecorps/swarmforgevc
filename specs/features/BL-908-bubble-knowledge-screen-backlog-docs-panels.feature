# mutation-stamp: sha256=7fd73d0c1fad5d1b8124229c616f1bcbce19d9206391218d6e7290d25b0f4ba9
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-17T00:23:06.395284Z","feature_name":"Bubble browses the backlog and the docs from the packages held on the device, with the network off, and says how old they are","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-908-bubble-knowledge-screen-backlog-docs-panels.feature","background_hash":"51bf1e8a0d24f699c5e0c488f12daa73c16613e0a45234ad73fbc96e23f9f0d9","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the docs panel lists the documents the package carries and opens one","scenario_hash":"9c14261c2ca269565a19ba8eb191cd4a259b6a708da5079d5a21cde51eedbfbb","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-17T00:23:06.395284Z"},{"index":4,"name":"every panel states the generation of the package it is reading","scenario_hash":"905453ab224c78f74d464848f5a4f5c29681b208ba1337941a2aaacb29e33704","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-17T00:23:06.395284Z"},{"index":0,"name":"the backlog panel lists the tickets of each folder the package carries","scenario_hash":"e1dd725e27a4462cf5d2ce644cfcbf8ccc2bb88d02cc64668c0928423ab5ab83","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-17T00:06:48.585463Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble browses the backlog and the docs from the packages held on the device, with the network off, and says how old they are

  # BL-908 (epic BL-865, slice 3 of 5, depends on BL-907): this is the browsable knowledge
  # screen itself — the native-Kotlin retarget of BL-659's corpus goals, confirmed by the
  # human 2026-08-16 ("the previously-approved PWA knowledge-explorer becomes the
  # native-Kotlin knowledge-screen slice, Pages PWA goes maintain-only, rather than being
  # retired"). BL-907 put the packages on the device; this slice is what the human actually
  # reads on the tube. Scope is bounded by what BL-866 actually serves: the backlog package
  # (the four folders of tickets) and the docs package (the vision documents). BL-659's
  # other corpus roots — constitution, briefings, evidence, Gherkin, FLOW, COST — need new
  # bridge packages first and stay BL-659's own unminted slices. Browsing performs no
  # network work at all: everything on screen came out of the cache, which is why it works
  # in airplane mode and why every view has to carry the generation it was read at.

  Background:
    Given the device holds a "backlog" package at generation "aaaa1111"
    And the device holds a "docs" package at generation "cccc3333"

  # BL-908 backlog-panel-lists-tickets-by-folder-01
  Scenario Outline: the backlog panel lists the tickets of each folder the package carries
    When the "backlog" panel is opened
    And the "<folder>" folder is chosen
    Then the tickets the package holds under "<folder>" are listed

    Examples:
      | folder |
      | active |
      | paused |
      | hold   |
      | done   |

  # BL-908 opening-a-ticket-shows-its-detail-02
  Scenario: opening a listed ticket shows the detail the package carries for it
    Given the "backlog" package holds a ticket "BL-866" under "done"
    When the "backlog" panel is opened
    And "BL-866" is opened
    Then the "title" the package holds for "BL-866" is shown
    And the "description" the package holds for "BL-866" is shown

  # BL-908 docs-panel-lists-and-opens-a-doc-03
  Scenario Outline: the docs panel lists the documents the package carries and opens one
    Given the "docs" package holds a "<kind>" document "<title>"
    When the "docs" panel is opened
    Then "<title>" is listed
    When "<title>" is opened
    Then the "content" the package holds for "<title>" is shown

    Examples:
      | kind     | title         |
      | markdown | Specification |
      | mermaid  | Architecture  |

  # BL-908 browsing-works-with-the-network-off-04
  Scenario: both panels browse fully with the network off
    Given the bridge is unreachable
    When the "backlog" panel is opened
    And the "docs" panel is opened
    Then both panels show the content the packages hold
    And no request is made to the bridge

  # BL-908 every-view-carries-its-provenance-05
  Scenario Outline: every panel states the generation of the package it is reading
    When the "<panel>" panel is opened
    Then the view states it is as of generation "<generation>"

    Examples:
      | panel   | generation |
      | backlog | aaaa1111   |
      | docs    | cccc3333   |

  # BL-908 nothing-held-yet-says-so-06
  Scenario: with no package held yet a panel says so rather than showing an empty list
    Given nothing has been cached on the device
    When the "backlog" panel is opened
    Then the panel reports that no copy is held
    And no empty ticket list is shown
