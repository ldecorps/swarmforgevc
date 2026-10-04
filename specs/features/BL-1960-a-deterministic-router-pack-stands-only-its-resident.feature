Feature: BL-1960 A deterministic router pack stands only its resident

  Split from BL-1931 (2026-10-04): the router-pack half, after BL-1959 drops
  the coordinator seat at launch. On a rotation-router pack
  `is_sequential_dormant` assumes the coordinator is the last role, so with
  no coordinator seat QA must not become a second standing session. The
  all-local iq3 mono-router pack declares `config coordinator_mode
  deterministic`.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"

  # BL-1960 router-pack-keeps-one-standing-session-01
  Scenario: a deterministic router pack still stands only its resident
    When the pack is launched
    Then the resident's session is the only role session created
