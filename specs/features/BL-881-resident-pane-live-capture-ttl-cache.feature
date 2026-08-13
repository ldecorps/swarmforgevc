# Backlog: BL-881
Feature: Resident-pane live capture TTL cache
  The Mini App polls /resident-pane on a short interval. Each live capture
  is a synchronous tmux + filesystem walk. Without a short TTL cache,
  overlapping polls wedge the bridge event loop.

  Background:
    Given a project root with a mono-router live-screen capture surface

  Scenario: Overlapping captures within the TTL share one walk
    Given a live-screen capture for a target path has completed
    When a second capture for the same target path is requested within the TTL
    Then the second call returns the cached snapshot
    And no second synchronous tmux+filesystem walk starts

  Scenario: Expired or cleared cache forces a fresh walk
    Given a cached live-screen snapshot for a target path
    When the TTL has expired or clearResidentPaneLiveCache has been called
    And a capture for that target path is requested
    Then a fresh synchronous walk runs
    And the returned snapshot reflects the new capture

  Scenario: Mini App poll interval does not outrun the capture TTL
    Given the Resident Spy Mini App HTML served by the bridge
    Then its live refresh interval is at least 4 seconds
    And the bridge live-capture TTL is 5 seconds
