Feature: Bubble keeps the bridge's packages on the device, refreshes them cheaply, and never presents cached data as live

  # BL-907 (epic BL-865, slice 2 of 5, depends on BL-866): BL-866 gave the bridge a
  # companion-manifest advertising versioned JSON packages, each body carrying the
  # generation the manifest advertised, and a cheap-refresh answer when the client already
  # holds that generation. Nothing on the phone reads it yet. This slice is the phone half:
  # fetch network-first, keep what was fetched, serve reads from the cache when the bridge
  # is out of reach, and label everything with the generation it was actually cached at.
  # Two things make this more than a download. The human's honesty requirement is that
  # cached data announces its age ("as of <generation>") rather than passing for live. And
  # a sync that goes wrong — a dead tunnel, a package the bridge refuses — must never cost
  # the human the copy they already had; the tube and the plane are the whole point.

  Background:
    Given Bubble is paired with a bridge

  # BL-907 first-sync-caches-and-labels-01
  Scenario: a first successful sync caches each advertised package at the generation it was served
    Given the bridge has "backlog" at generation "aaaa1111"
    And nothing has been cached on the device
    When Bubble syncs
    Then the held "backlog" package is the body served at generation "aaaa1111"
    And the held "backlog" package is labelled as of generation "aaaa1111"

  # BL-907 unchanged-generation-costs-no-body-02
  Scenario: a refresh that finds nothing changed keeps the cached copy and downloads no body
    Given the device holds the "backlog" package at generation "aaaa1111"
    And the bridge has "backlog" at generation "aaaa1111"
    When Bubble syncs
    Then the bridge answers that "backlog" is unchanged and sends no body
    And the held "backlog" package is labelled as of generation "aaaa1111"

  # BL-907 moved-generation-replaces-and-relabels-03
  Scenario: a moved generation replaces the cached copy and the label moves with it
    Given the device holds the "backlog" package at generation "aaaa1111"
    And the bridge has "backlog" at generation "bbbb2222"
    When Bubble syncs
    Then the held "backlog" package is the body served at generation "bbbb2222"
    And the held "backlog" package is labelled as of generation "bbbb2222"

  # BL-907 offline-reads-come-from-the-cache-04
  Scenario: with the bridge out of reach a read is served from the cache, still labelled at its own generation
    Given the device holds the "backlog" package at generation "aaaa1111"
    And the bridge is unreachable
    When the "backlog" package is read
    Then the held "backlog" package is the body served at generation "aaaa1111"
    And the held "backlog" package is labelled as of generation "aaaa1111"

  # BL-907 a-failed-sync-never-damages-the-cache-05
  Scenario Outline: a sync that cannot deliver a package leaves the cached copy intact and readable
    Given the device holds the "backlog" package at generation "aaaa1111"
    And syncing "backlog" fails with "<failure>"
    When Bubble syncs
    And the "backlog" package is read
    Then the held "backlog" package is the body served at generation "aaaa1111"
    And the held "backlog" package is labelled as of generation "aaaa1111"
    And the failure to refresh is reported

    Examples:
      | failure     |
      | unreachable |
      | unreadable  |
      | unknown     |
      | interrupted |

  # BL-907 before-any-sync-a-read-says-so-06
  Scenario: before any successful sync a read reports that nothing is held rather than an empty package
    Given nothing has been cached on the device
    When the "backlog" package is read
    Then the read reports that no copy is held
    And no body is returned
