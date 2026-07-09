Feature: handoff transport is trustworthy end-to-end (verified by the children)

# BL-151 epic-done-01
Scenario: the epic is complete when every child slice has landed
  Given BL-152, BL-121, BL-122, BL-128, and BL-146 are each merged and closed
  Then handoff wakes reach idle recipients (BL-152)
  And dead-letters/canary-miss flip transport health off "healthy" (BL-121)
  And dead-lettered parcels are auto-recovered or escalated to a human, never
    left rotting silently (BL-122)
  And the coordinator/specifier no longer share one physical inbox (BL-128)
  And exactly one process owns delivery and chase/recovery (BL-146)

# Non-behavioral gate:
#  - This umbrella carries no code; its acceptance is the union of its
#    children's acceptance. Do NOT promote BL-151 as a work slice — promote
#    the children in sequence.
