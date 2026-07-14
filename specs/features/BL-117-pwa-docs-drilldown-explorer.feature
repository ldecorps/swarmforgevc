Feature: documentation is explorable from vision level down to scenarios

# BL-117 docs-drilldown-01
Scenario: full drill path from vision to a Gherkin scenario
  Given the published documentation artifact for the current main
  When the app user opens the documentation explorer
  Then the vision level lists the product docs and both diagrams
  And drilling into a milestone lists that milestone's tickets with
    folder-authoritative status
  And drilling into a ticket shows its prose description
  And drilling into the ticket's acceptance shows its Gherkin scenarios
    as readable scenario text

# BL-117 docs-drilldown-02
Scenario: the documentation is live against main
  Given a backlog or docs change has been merged to main
  When the Action publishes and the app next fetches
  Then the explorer reflects the change at every affected level
  And no app update or manual export was required

# BL-117 docs-drilldown-03
Scenario Outline: both acceptance forms render
  Given a ticket whose acceptance is <form>
  When the user drills to its Gherkin level
  Then the scenarios are shown as readable scenario text

  Examples:
    | form                                      |
    | an inline YAML acceptance block           |
    | a reference to a specs/features/ file     |

# BL-117 docs-drilldown-04
Scenario: offline exploration of the cached snapshot
  Given the app previously fetched the documentation artifact
  When the device is offline
  Then the explorer remains browsable at every level
  And the view is labeled with the commit/timestamp it was rendered from

# BL-117 docs-drilldown-05
Scenario: exploration is read-only
  Given any level of the documentation explorer
  Then no affordance exists to edit documentation or create/modify
    tickets

# Non-behavioral gates:
#  - All derivation lives in the Action renderer (tested); the PWA
#    client renders fetched data only — no YAML/markdown parsing or
#    status re-derivation in browser JS.
#  - Self-contained client assets (no CDN fetches), consistent with
#    BL-097; no browser storage beyond the PWA cache of the artifact.
#  - Public-repo exposure note from BL-097 applies unchanged.
