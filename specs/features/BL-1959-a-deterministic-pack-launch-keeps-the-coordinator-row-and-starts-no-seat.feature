Feature: BL-1959 A deterministic pack's launch keeps the coordinator's row and starts no coordinator seat

  Split from BL-1931 (2026-10-04): the launcher half. BL-1846 made handoffd
  promote and route the next ticket itself, and BL-1847 relays every parcel
  that reaches the coordinator's mail to the human, on a pack that declares
  `config coordinator_mode deterministic`. The launcher still provisions a
  coordinator seat on that pack. This slice drops the seat at launch and
  keeps everything that routes by the coordinator's roster row: its
  roles.tsv row and its mailbox. The router pack's single standing session
  is BL-1960.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"

  # BL-1959 deterministic-pack-launch-keeps-the-row-drops-the-seat-01
  Scenario: launching a deterministic pack keeps the coordinator's row and mailbox but starts no coordinator seat
    When the pack is launched
    Then roles.tsv carries a coordinator row
    And the coordinator's inbox directories exist
    And no swarmforge-coordinator session was created
    And no coordinator launch script was written
    And the coder session is among the sessions created

  # BL-1959 a-non-deterministic-pack-still-provisions-the-seat-02
  Scenario: a pack without the deterministic declaration still provisions the coordinator seat
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    When the pack is launched
    Then a coordinator launch script was written
    And the coordinator session is among the sessions created
