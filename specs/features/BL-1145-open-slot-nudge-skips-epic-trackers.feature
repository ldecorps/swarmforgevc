Feature: open-slot nudge skips type epic trackers
  Open-slot nudge/escalation named BL-545 (type: epic) as top candidate
  through 3 nudges while promote_and_route_next correctly refuses epics.
  After BL-1100 removed prose do-not-promote greps, promotion_gates_lib
  evaluate still lacks a type: epic refusal — so epic trackers can win the
  nudge forever and leave the open slot empty. Specifier locks adding
  structured type: epic (and status: blocked if promote already skips it)
  refusal to promotion_gates_lib/evaluate so every consumer inherits one
  chain (BL-663). Do not promote BL-545 to fix the alert. Source:
  backlog/INTAKE-open-slot-nudge-escalates-on-epic-trackers.md.

  Background:
    Given promote_and_route_next refuses type: epic via is_epic_type
    And open-slot nudge currently picks candidates via promotion_gates_lib evaluate

  # BL-1145 epic-never-open-slot-top-01
  Scenario: a paused epic is never the open-slot top candidate
    Given a paused type: epic ranks above all non-epic paused tickets
    And an open active slot exists
    When open-slot candidacy is evaluated
    Then the epic is not named as top open-slot candidate
    And it does not accrue open-slot nudge or escalation count

  # BL-1145 non-epic-wins-when-both-present-02
  Scenario: a real non-epic wins the nudge when an epic ranks higher by priority
    Given a paused epic with priority 1
    And a paused feature with priority 2 that promote would pick
    When open-slot top candidate is chosen
    Then the feature is named
    And decide-open-slot-nudge? is not kept true by epics alone

  # BL-1145 explicit-promote-epic-still-refuses-03
  Scenario: explicit promote of an epic still refuses
    When promote_and_route_next is asked to promote a type: epic id
    Then it refuses with an epic gate
    And open-slot candidacy shares that structured epic exclusion with evaluate
