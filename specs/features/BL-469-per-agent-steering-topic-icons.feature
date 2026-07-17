Feature: Per-agent Telegram steering-topic icons
  Each of the swarm's eight per-agent Telegram steering topics (BL-425) carries a
  fixed, human-chosen icon so the human can tell the role topics apart at a glance.
  Icons are applied through the EXISTING standing-topic icon sync
  (topicIconSync.syncTopicIcon): validated against Telegram's live
  getForumTopicIconStickers set, ownership-guarded, and best-effort. The mapping is
  the human's firm 2026-07-16 decision.

  Background:
    Given the swarm owns a per-agent steering topic for each of its eight roles

  # BL-469 per-agent-steering-topic-icon-01
  Scenario Outline: <role> steering topic shows its mapped icon
    Given Telegram's live sticker set offers the icon "<icon>"
    When the per-agent steering-topic icon sync runs for the newly-owned topics
    Then the "<role>" steering topic icon is set to "<icon>"

    Examples:
      | role        | icon |
      | coordinator | 📣   |
      | specifier   | 📝   |
      | architect   | 🏛   |
      | coder       | 💻   |
      | cleaner     | 🧼   |
      | hardender   | 🧪   |
      | QA          | 🔎   |
      | documenter  | 📰   |

  # BL-469 per-agent-steering-topic-icon-02
  Scenario: an icon Telegram does not offer is surfaced, not applied, and does not block the other roles
    Given Telegram's live sticker set does NOT offer the coder's mapped icon
    And it offers every other role's mapped icon
    When the per-agent steering-topic icon sync runs for the newly-owned topics
    Then the coder steering topic icon sync outcome is "skipped-unresolved-icon"
    And every other role's steering topic icon is set to its mapped icon

  # BL-469 per-agent-steering-topic-icon-03
  Scenario: a steady-state tick does not re-edit an already-set per-agent topic icon
    Given every per-agent steering topic already carries its mapped icon set by the swarm
    When the per-agent steering-topic icon sync runs again on an unchanged tick
    Then no per-agent steering topic icon is re-edited
