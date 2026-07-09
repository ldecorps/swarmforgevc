Feature: backlog-depth cap reads the real config and honors the no-limit sentinel

# BL-216 depth-01
Scenario Outline: the depth warning fires only for a positive cap the active count exceeds
  Given swarmforge/swarmforge.conf sets active_backlog_max_depth to <cap>
  And backlog/active/ holds <active> items
  When a handoff is written
  Then a depth-exceeded warning <warns>

  Examples:
    | cap | active | warns          |
    | -1  | 5      | is not emitted |
    | 3   | 5      | is emitted     |
    | 3   | 2      | is not emitted |

# BL-216 depth-02
Scenario: the -1 sentinel leaves promotion ungated by depth
  Given swarmforge/swarmforge.conf sets active_backlog_max_depth to -1
  And backlog/active/ is non-empty and backlog/paused/ has an item
  When ready_for_next runs its depth gate
  Then the depth cap is treated as unlimited, not a mis-parsed cap of 1

# BL-216 depth-03
Scenario: the cap comes from the tracked config, not a silent default
  Given the tracked swarmforge/swarmforge.conf is the config present
  And no .swarmforge/swarmforge.conf exists
  When the depth cap is read
  Then its value comes from the tracked file, not the fallback default

# BL-216 depth-04
Scenario: an absent config degrades gracefully
  Given no swarmforge.conf is present
  When the depth check runs
  Then it does not crash
  And no spurious over-cap warning is emitted

# Non-behavioral gates:
#  - Both swarm_handoff.bb and ready_for_next.bb use ONE shared conf-reading
#    helper (real path + signed parse + <0 => no limit); no copy-paste twin.
#  - The reader is a pure function over provided conf text (fixtures); call-site
#    behavior is tested over a temp backlog/active + backlog/paused tree. No
#    network, no real timers.
#  - Out of scope: whether ready_for_next.bb should auto-promote at all (that
#    overlaps the coordinator's promotion authority) — flagged, not changed.
