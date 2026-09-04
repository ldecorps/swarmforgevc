Feature: BL-1399 The freshness property fixture supplies its own required registry

  The freshness watchdog's registry guard fails closed when a daemon in the
  required list has no row in the conf. The watchdog's property fixture
  pins a one-row conf on purpose but lets the guard read the live required
  list, so the guard refuses and three properties are red without any
  watchdog defect. This feature is that the fixture hands the guard its
  own required list through the seam the guard already reads, and that the
  guard itself still bites.

  Background:
    Given a freshness fixture root with a one-row conf for handoffd

  # BL-1399 the-fixture-registry-matches-its-conf-01
  Scenario: the checker runs green against the fixture's own registry
    Given the fixture supplies a required registry naming only handoffd
    When the freshness checker runs against the fixture
    Then the checker exits zero
    And the guard read the fixture's registry, not the live one

  # BL-1399 the-guard-still-bites-02
  Scenario: a fixture registry naming a daemon the conf lacks is still refused
    Given the fixture supplies a required registry naming handoffd and babysitterd
    When the freshness checker runs against the fixture
    Then the checker exits non-zero
    And its output names babysitterd as having no row

  # BL-1399 green-on-main-03
  Scenario: the watchdog property test passes on main
    When the bl1012 property test runs
    Then every property holds
