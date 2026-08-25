Feature: the handoff depth warning counts tickets, not directory entries

  Three places in this repo count the active backlog. Two of them —
  handoffd's open-slot gate and its status snapshot — count YAML tickets.
  The third, the warning `swarm_handoff.bb` prints on every send, counts raw
  directory entries, so the permanent `.gitkeep` is reported as a ticket and
  every warning overstates the depth by one.

  The promotion decision itself is unaffected: it uses the YAML counter. What
  is affected is every human and agent reading the warning, which is printed
  on literally every handoff in the swarm.

  Background:
    Given an active backlog directory containing a .gitkeep file

  # BL-683 depth-warning-count-01
  Scenario: the warning counts only ticket files
    Given the directory holds four ticket files
    When the handoff depth check runs
    Then the reported active count is four

  # BL-683 depth-warning-count-02
  Scenario: a directory holding only non-ticket entries counts as empty
    Given the directory holds no ticket files
    When the handoff depth check runs
    Then the reported active count is zero

  # BL-683 depth-warning-count-03
  Scenario: the three active-backlog counters agree
    Given the directory holds four ticket files
    Then the handoff depth check, the open-slot gate and the status snapshot report the same count
