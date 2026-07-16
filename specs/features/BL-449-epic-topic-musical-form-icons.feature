Feature: epic topics carry distinct musical-form icons

  # An epic is a large-scale musical FORM, so each epic topic gets its own
  # performance-emoji icon (a separate concern from BL-342's ticket-STATE icon
  # sync, which epics are deliberately never a target of). The three seeded
  # epics get finalised, distinct glyphs (🎙 / 🎭 / 🎬); every newly-created
  # epic topic is auto-assigned the next distinct icon from an ordered
  # musical-form pool. Telegram topic icons are limited to the free
  # getForumTopicIconStickers set (no notation/instruments), so a desired emoji
  # absent from the live set is skipped rather than sent unvalidated, and the
  # epic pool never collides with the ticket-state or standing-topic icons
  # already in use (🎵 feature, 🎟 intake, 🏛 operator; 🎶 avoided — it reads as
  # 🎵 at badge size). The owned SVG "forms" (symphony/concerto/…) are the
  # PWA/bot-avatar realisation of the same rule; these stock stickers are the
  # Telegram stand-in.

  Background:
    Given epic icons are a separate concern from the ticket-state icons in topicIcon.ts

  # BL-449 epic-icon-assignment-01
  Scenario Outline: each seeded epic topic maps to its finalised musical-form icon
    Given the epic "<epic>"
    When its epic icon is resolved
    Then the epic icon is "<emoji>"

    Examples:
      | epic            | emoji |
      | BENCHMARKING    | 🎙    |
      | DYNAMIC_ROUTING | 🎭    |
      | ONBOARDING      | 🎬    |

  # BL-449 epic-icon-new-topic-02
  Scenario: a newly-created epic topic is auto-assigned the next distinct pool icon
    Given the seeded epics already hold their musical-form icons
    When a new epic topic beyond the seeded set is created
    Then it is assigned a musical-form icon from the pool
    And that icon differs from every already-assigned epic icon while the pool has unused slots

  # BL-449 epic-icon-disjoint-03
  Scenario: epic icons never collide with the ticket-state or standing-topic icons
    Given the ticket-state icons and standing-topic icons already in use
    When the epic musical-form pool is resolved
    Then no epic pool icon equals any ticket-state icon or standing-topic icon

  # BL-449 epic-icon-live-set-04
  Scenario: an epic emoji absent from the live icon set is skipped, never sent unvalidated
    Given an epic's desired musical-form emoji is absent from Telegram's live forum-topic icon set
    When the epic topic's icon is applied
    Then no icon is set on the epic topic and it is left unchanged

  # BL-449 epic-icon-ownership-05
  Scenario Outline: ownership governs whether the epic-icon path may set an icon
    Given an epic topic whose current icon the swarm "<ownership>"
    When the "<pass>" evaluates that epic topic
    Then the epic topic icon is "<result>"

    Examples:
      | ownership | pass      | result    |
      | not-owned | live-tick | unchanged |
      | not-owned | backfill  | set       |
      | owned     | live-tick | set       |
