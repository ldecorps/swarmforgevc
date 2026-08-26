Feature: Sticky web UI font-size choice across phone / Mini App / dashboard pages
  Several web surfaces expose a text-size control, but persistence is
  inconsistent: the PWA dashboard sticks via a purge-exempt preferences
  Cache; Pipeline Board and Paused pager use per-page localStorage; the
  Resident Spy Live Screen (BL-609) deliberately resets to 13px on full
  Mini App reload.

  The human wants the chosen size to stick after reload, closing the Mini
  App, or leaving and returning — with one Rule-3-compatible sticky
  contract across the pages that offer a size control. Clamp/step ranges
  may stay surface-specific.

  Background:
    Given the operator can open the Live Screen Mini App
    And the operator can open the Pipeline Board Mini App
    And the operator can open the Paused pager Mini App
    And the operator can open the PWA dashboard

  # BL-1153 sticky-web-font-live-screen-survives-reload-01
  Scenario: Live Screen pane font size survives a full Mini App reload
    Given the Live Screen pane font size is set to a non-default value within its clamp
    When the Mini App is fully reloaded
    Then the pane text renders at that chosen size
    And it does not reset to the BL-609 default of 13px

  # BL-1153 sticky-web-font-pipeline-paused-survive-02
  Scenario Outline: Pipeline Board and Paused pager restore size after reload
    Given the "<surface>" text size is set to a non-default value within its clamp
    When that page is fully reloaded
    Then the text renders at that chosen size

    Examples:
      | surface        |
      | Pipeline Board |
      | Paused pager   |

  # BL-1153 sticky-web-font-pwa-unchanged-03
  Scenario: PWA dashboard A-/A+ sticky behaviour is not regressed
    Given the PWA dashboard font size is set via A-/A+
    When the dashboard is reloaded
    Then the chosen size is restored from the preferences Cache as today

  # BL-1153 sticky-web-font-rule3-seam-04
  Scenario: Mini App persistence uses a Rule-3-compatible host seam
    Given the Live Screen, Pipeline Board, and Paused pager persist a font-size choice
    When the persistence mechanism is inspected
    Then it does not rely on localStorage or sessionStorage in the webview
    And it persists via the extension host (workspace state or host-served preference file) or an explicit recorded Rule-3 waiver

  # BL-1153 sticky-web-font-corrupt-falls-back-05
  Scenario: Missing or corrupt stored value falls back to each surface default
    Given the stored font-size preference for a surface is missing or corrupt
    When that surface loads
    Then it uses that surface's existing default size
