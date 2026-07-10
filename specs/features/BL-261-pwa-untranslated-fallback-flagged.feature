Feature: the phone app flags an untranslated French rendering instead of passing English off as French

  # Operator report 2026-07-10 (via QA): on the docs drill-down, "Show French
  # rendering" reveals a block word-for-word identical to the English above it, with
  # no sign anything is wrong. Root cause (QA): translate.ts degrades on any MT
  # failure to { text: <English>, untranslated: true } (bilingual-05: a translation
  # failure must never block publishing); docsTree.ts correctly publishes the paired
  # *Untranslated flags on docs-tree.json — but pwa/app.js NEVER reads them (grep:
  # zero references) and renders the *Fr fields unconditionally. No PWA-layer test
  # exercises the untranslated path, so it shipped since BL-118/BL-230.
  #
  # REUSE: the *Untranslated flags already exist and are correctly computed/published
  # — this is a PWA RENDERING-LAYER fix only (no translate.ts/docsTree.ts change).
  # The indicator string is localized via pwa/locales.js (BL-229/230). Fix is
  # SYSTEMIC: all four surfaces that read a *Fr field (ticket title, description,
  # vision doc content, Gherkin scenario reveal).

  Background:
    Given the phone docs drill-down where a French rendering may be a real translation or an untranslated English fallback

  # BL-261 untranslated-flagged-01
  Scenario Outline: an untranslated French rendering is flagged, not passed off as French
    Given a "<surface>" whose French field is an untranslated English fallback
    When the operator views its French rendering
    Then a machine-translation-unavailable indicator is shown
    And the fallback text is not presented as a genuine French translation

    Examples:
      | surface            |
      | ticket title       |
      | ticket description |
      | vision doc content |
      | Gherkin scenario   |

  # BL-261 real-translation-not-flagged-02
  Scenario: a genuine translation shows no unavailable indicator
    Given a French field that is a genuine translation
    When the operator views its French rendering
    Then the translated text is shown with no machine-translation-unavailable indicator

  # BL-261 indicator-localized-03
  Scenario: the unavailable indicator string is localized
    Given an untranslated French rendering
    When the indicator is shown
    Then its text comes from the locale table rather than a hardcoded string
