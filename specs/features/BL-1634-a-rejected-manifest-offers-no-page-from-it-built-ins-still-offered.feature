Feature: BL-1634 A rejected manifest offers no page from it while the built-in pages are still offered

  BL-829's landed scenario "a malformed page list rejects the whole
  manifest" has been red on main since BL-1166 landed the bridge's
  built-in pages on 2026-08-27: its handler demands an empty offered list
  where the scenario only says no page from the malformed manifest is
  offered, and the built-in health, host and operator-docs pages fail it.
  BL-775, in flight, adds a fourth built-in named live, the id the fixture
  uses. This feature is that a malformed operator manifest is rejected
  whole, that none of its page ids reaches the shell, that the bridge's
  built-in pages are offered regardless, and that a malformed entry
  sharing a built-in's id cannot smuggle its own entry in. BL-829's own
  scenario going green is QA's e2e step, not a scenario here.

  Background:
    Given a running swarm and the bridge started via its opt-in command for BL-1634

  # BL-1634 rejected-manifest-offers-no-page-from-it-01
  Scenario: a malformed manifest with a non-built-in page id is rejected whole and the built-ins are still offered
    Given the served manifest carries a malformed page list whose entry id is not a built-in page
    When the manifest is validated
    Then it is rejected whole
    And no offered page carries the malformed entry's id
    And every built-in page is still offered

  # BL-1634 rejected-manifest-offers-no-page-from-it-02
  Scenario: a malformed entry sharing a built-in's id yields the built-in entry, never the manifest's
    Given the served manifest carries a malformed page list whose entry id equals a built-in page's id
    When the manifest is validated
    Then it is rejected whole
    And the offered page with that id is the bridge's built-in entry, not the manifest's
