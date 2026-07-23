Feature: Suite-test duration rides a committed sidecar onto the static PWA

  Background:
    Given suite-test duration is snapshotted into the committed daily sidecar that the backlog projection reads

  # BL-290 suite-duration-pwa-01
  Scenario: the committed daily sidecar carries the suite-duration trend
    Given a run with local suite-duration records
    When the daily sidecar is emitted
    Then the committed sidecar carries the suite-duration trend

  # BL-290 suite-duration-pwa-02
  Scenario: the backlog projection reads the trend from the committed sidecar
    Given the committed sidecar carries the suite-duration trend
    When the backlog projection is built
    Then its metrics include the trend from that sidecar

  # BL-290 suite-duration-pwa-03
  Scenario: the static PWA shows the latest suite duration and its trend
    Given the projection has a suite-duration trend to show
    When the dashboard renders
    Then the PWA shows the latest suite duration and its trend

  # BL-290 suite-duration-pwa-04
  Scenario: a regressing suite duration is marked on the PWA
    Given the projection reports the suite duration as regressing
    When the dashboard renders
    Then the PWA marks it as a regression

  # BL-290 suite-duration-pwa-05
  Scenario: with no local data the PWA shows a no-data readout without fetching
    Given the projection has no local suite-duration data
    When the dashboard renders
    Then the PWA shows a no-data suite-duration readout without any live fetch
