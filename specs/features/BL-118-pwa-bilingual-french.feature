Feature: the app is fully usable in French and English

# BL-118 bilingual-01
Scenario: first launch is English regardless of browser locale
  Given a device whose browser locale is fr or fr-*
  When the app is opened for the first time
  Then all UI chrome renders in English
  And the FR/EN toggle is visible

# BL-118 bilingual-02
Scenario: the language toggle is instant and durable
  Given the app is displaying in English
  When the user switches the toggle to FR
  Then chrome and content re-render in French without a reload
  And after closing and reopening the app, French is still active

# BL-118 bilingual-03
Scenario: documentation content is translated and stays live
  Given a published artifact rendered after a docs/backlog change
  When the user browses the documentation explorer in FR mode
  Then doc sections, ticket titles, and descriptions display in French
  And a source string unchanged since the previous publish was served
    from the translation cache, not re-translated

# BL-118 bilingual-04
Scenario: Gherkin shows canonical English with French on tap
  Given a ticket's scenarios viewed in FR mode
  Then the scenario text displays in canonical English
  And one tap reveals the French rendering of that scenario

# BL-118 bilingual-05
Scenario: missing translations degrade to flagged English
  Given a string whose translation is unavailable at publish time
  When the artifact is published and viewed in FR mode
  Then the publish succeeded
  And that string displays in English with an untranslated marker

# BL-118 bilingual-06
Scenario: identifiers and code are never translated
  Given FR mode
  Then ticket ids, file paths, commit hashes, code blocks, and diagram
    sources render verbatim as authored

# BL-118 bilingual-07
Scenario: offline works in both languages
  Given the app previously fetched the artifact
  When the device is offline
  Then switching between FR and EN still renders both fully

# Non-behavioral gates:
#  - Translation pass tested with a fake MT engine (records calls):
#    assert hash-cache hits/misses, fallback flagging, and that only
#    changed strings are sent. No live translation API in tests.
#  - MT API key only ever a GitHub Actions secret; grep-able absence
#    from client bundle and repo.
#  - English remains the binding acceptance contract; nothing in the
#    pipeline (BL-111..113 APS tooling) consumes the French text.
