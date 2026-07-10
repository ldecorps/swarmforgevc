Feature: Every PWA UI label routes through the locale catalog, not a hardcoded English literal

  # BL-118 localized the chrome, but a few user-visible labels in the render
  # functions are still inline English literals that bypass the translator, so
  # they stay English in French mode: pwa/app.js:195 ' — ETA ', :233 ' remaining'
  # (and the raw status badge at :417 is a candidate). Route each through the
  # tr(...) catalog (new keys in both en/fr in locales.js). Per the operator,
  # ordinary words are translated (e.g. remaining -> restants) while jargon may
  # keep its English value in the French catalog (e.g. "ETA" can stay "ETA").
  # This is the app's own labels only — ticket/doc CONTENT translation is BL-230.

  # BL-229 label-catalog-01
  Scenario: the burndown "remaining" label is localized in French
    Given the PWA in French
    When the burndown is rendered
    Then the remaining-count label shows its French catalog value, not the English word "remaining"

  # BL-229 label-catalog-02
  Scenario: the ETA label is sourced from the catalog, jargon value allowed
    Given the PWA in French
    When a ticket ETA is rendered
    Then the ETA label is a catalog lookup, whose French value may remain "ETA" as jargon

  # BL-229 no-hardcoded-03
  Scenario: no user-visible label is an inline English literal in the render code
    Given the PWA render functions
    When they build user-visible label text
    Then every such label is a tr(...) catalog lookup, not an inline English string literal

# Non-behavioral gates:
#  - Audit pwa/app.js for inline user-visible English label literals; the known
#    ones are ' — ETA ' (line 195) and ' remaining' (line 233); also review the
#    ' [status]' badge (line 417). Add matching keys to BOTH the en and fr blocks
#    of pwa/locales.js.
#  - English mode is byte-for-byte unchanged (the en catalog values equal today's
#    literals).
