Feature: Epic topic icons draw from the whole stock sticker set

  Architecture Rule 6, amended 2026-08-19, drops the musical/performance
  restriction on the Telegram epic-icon surface. EPIC_ICON_POOL is sized
  against the live epic count instead of a 14-glyph subset, and the two
  conditions that actually bind a pick - present in the live sticker set,
  colliding with no other icon table - become assertions rather than
  comments.

  Background:
    Given the epic icon pool
    And the reserved icon tables ICON_EMOJI, STANDING_TOPIC_ICON and ROLE_TOPIC_ICON

  # BL-946 epic-icon-pool-wider-stock-set-01
  Scenario: The pool is sized above the live epic count with headroom
    When the pool size is measured
    Then it holds at least 60 icons

  # BL-946 epic-icon-pool-wider-stock-set-02
  Scenario: The pool carries no duplicate glyph
    When the pool is checked for repeats
    Then every entry appears exactly once

  # BL-946 epic-icon-pool-wider-stock-set-03
  Scenario Outline: No pool icon collides with a reserved icon table
    When the pool is compared against <table>
    Then no glyph appears in both

    Examples:
      | table               |
      | ICON_EMOJI          |
      | STANDING_TOPIC_ICON |
      | ROLE_TOPIC_ICON     |

  # BL-946 epic-icon-pool-wider-stock-set-04
  Scenario: Every epic in the live backlog resolves to a distinct icon
    Given 39 distinct epic ids
    When each is resolved in one pass, threading the already-assigned icons
    Then all 39 receive different icons
    And no exhaustion reuse occurs

  # BL-946 epic-icon-pool-wider-stock-set-05
  Scenario: A known epic keeps its pinned glyph
    Given the epic id "role-benchmarking"
    When it is resolved after other epics have drained the pool
    Then it receives its pinned glyph

  # BL-946 epic-icon-pool-wider-stock-set-06
  Scenario: Exhausting the pool degrades gracefully instead of throwing
    Given every pool icon is already assigned
    When an unknown epic id is resolved
    Then it receives the pool's last icon
    And no error is raised
