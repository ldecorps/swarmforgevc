Feature: PWA sections collapse and remember their state via the preferences cache

  Background:
    Given the static PWA renders each top-level section with a header control

  # BL-291 collapsible-sections-01
  Scenario: a section header control toggles its body closed and open
    Given a section whose body is shown
    When its header control is activated
    Then the section body is hidden
    And activating it once more shows the body again

  # BL-291 collapsible-sections-02
  Scenario: the section toggle is keyboard-operable and reports aria-expanded
    Given a section header control
    When it is operated by keyboard
    Then it toggles the section body
    And its aria-expanded reflects whether the section is open

  # BL-291 collapsible-sections-03
  Scenario: a collapsed section stays collapsed across a reload
    Given a section the human has collapsed
    When the PWA is reloaded
    Then that section is restored collapsed from the preferences cache

  # BL-291 collapsible-sections-04
  Scenario: collapsing one section leaves the others unchanged
    Given several expanded sections
    When one is collapsed
    Then only that section collapses and the rest stay expanded

  # BL-291 collapsible-sections-05
  Scenario: on a first-ever visit every section starts expanded
    Given no saved section state in the preferences cache
    When the dashboard first renders
    Then every section starts expanded
