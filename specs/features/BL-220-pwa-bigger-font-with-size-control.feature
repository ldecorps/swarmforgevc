Feature: The PWA phone app renders at a large default font and offers a persistent A-/A+ size control

  # The PWA (pwa/index.html + app.js) is a single page whose every view — the
  # dashboard, cost/health briefing, docs explorer, and gherkin recert pages —
  # sizes its text in rem, relative to the root (html) font-size. That root is
  # therefore the one knob that scales the whole app. Today body sets no explicit
  # size, so the app inherits the ~16px browser default and reads small on a
  # phone. The operator wants it "way bigger": a large default plus an A-/A+
  # control to fine-tune, remembered across reloads.
  #
  # Sizing decided by the specifier (implementer may tune within this spirit):
  #   default 28px (~1.75x the 16px browser default), step 2px, min 16px, max 40px.

  Background:
    Given the PWA phone app, whose views all size in rem from the root font-size

  # BL-220 default-large-01
  Scenario: first launch renders at the large default size
    Given no font-size preference has ever been saved
    When the page loads
    Then the root font-size is 28px
    And every view scales up from that root together

  # BL-220 step-02
  Scenario Outline: a size control changes the whole app one step, instantly
    Given the app is showing the default font size
    When the operator activates the "<control>" control
    Then the root font-size <direction> by one 2px step
    And the new size applies immediately with no reload

    Examples:
      | control | direction |
      | A+      | grows     |
      | A-      | shrinks   |

  # BL-220 clamp-03
  Scenario Outline: the size is clamped so it can never leave its bounds
    Given the root font-size is already at its <bound>
    When the operator activates the "<control>" control repeatedly
    Then the root font-size never passes <limit>

    Examples:
      | bound   | control | limit |
      | maximum | A+      | 40px  |
      | minimum | A-      | 16px  |

  # BL-220 persist-04
  Scenario: a chosen size survives closing and reopening the app
    Given the operator has changed the font size to a non-default value
    When the app is closed and reopened
    Then the page loads at the previously chosen size, not the default

# Non-behavioral gates:
#  - Persistence reuses the same Cache Storage instance the PWA already owns for
#    the locale preference (a new key in cache "swarmforge-dashboard-v2"), NOT
#    localStorage/sessionStorage or any other browser storage — mandated by the
#    project's webview/PWA storage restriction and matching the bilingual-02
#    pattern in app.js (loadPersistedLocale/persistLocale).
#  - Persistence is best-effort like the locale: if Cache Storage is unavailable,
#    the control still adjusts size for the session, it just will not survive a
#    reopen. Missing/corrupt saved value falls back to the 28px default.
#  - The A-/A+ buttons live in the page chrome alongside the existing locale
#    toggle without overlapping it, and carry accessible labels following the
#    existing data-i18n chrome-localization convention (add catalog keys to
#    pwa/locales.js for both locales).
#  - Scaling is achieved by setting the root (html) font-size only; no per-view
#    or per-rule font sizes are hand-edited, so the single knob keeps all views
#    proportional.
