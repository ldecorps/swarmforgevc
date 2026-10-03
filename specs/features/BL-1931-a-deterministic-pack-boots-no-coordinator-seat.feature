Feature: BL-1931 A pack declaring a deterministic coordinator boots no coordinator seat

  BL-1846 made handoffd promote and route the next ticket itself, and BL-1847
  relays every parcel that reaches the coordinator's mail to the human, on a
  pack that declares `config coordinator_mode deterministic`. The launcher
  still provisions a coordinator seat on that pack: on the all-local pack a
  second qwen client on the only GPU slot, which jammed the 2026-09-30 run.
  This slice drops the seat at launch and keeps everything that routes by the
  coordinator's roster row: its roles.tsv row and its mailbox. Keep-alive
  repair (BL-1932) and wakes into a router pack's resident (BL-1933) are
  separate slices.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"

  # BL-1931 deterministic-pack-launch-keeps-the-row-drops-the-seat-01
  Scenario: launching a deterministic pack keeps the coordinator's row and mailbox but starts no coordinator seat
    When the pack is launched
    Then roles.tsv carries a coordinator row
    And the coordinator's inbox directories exist
    And no swarmforge-coordinator session was created
    And no coordinator launch script was written

  # BL-1931 router-pack-keeps-one-standing-session-02
  Scenario: a deterministic router pack still stands only its resident
    When the pack is launched
    Then the resident's session is the only role session created

  # BL-1931 a-non-deterministic-pack-still-provisions-the-seat-03
  Scenario: a pack without the deterministic declaration still provisions the coordinator seat
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    When the pack is launched
    Then a coordinator launch script was written
    And the coordinator session is among the sessions created
