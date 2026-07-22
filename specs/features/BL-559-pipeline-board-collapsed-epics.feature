Feature: The pipeline board collapses paused epic trackers into one line per epic with child counts

  Epic trackers (type: epic) in backlog/paused/ are umbrella index cards, not promotable
  work. The PARKED section shows each as a single epic slug line with how many child
  slices are active or paused — not the tracker ticket id. Child slices still render as
  normal parked lines. Epic trackers awaiting human approval stay in AWAITING APPROVAL
  with their ticket id.

  # BL-559 collapsed-epics-01
  Scenario: A paused epic tracker renders as a collapsed epic line, not a parked ticket line
    Given a paused epic tracker for epic swarm-reliability
    And paused child slices under that epic
    When the pipeline board is computed
    Then the collapsed epics list names swarm-reliability with child counts
    And the tracker ticket id does not appear as a plain parked line

  # BL-559 collapsed-epics-02
  Scenario: An epic tracker awaiting human approval stays in AWAITING APPROVAL
    Given a paused epic tracker with human approval pending
    When the pipeline board is computed
    Then the tracker appears under AWAITING APPROVAL with its ticket id
    And it does not appear in the collapsed epics list
