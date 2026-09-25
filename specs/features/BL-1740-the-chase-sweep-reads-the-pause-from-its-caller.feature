Feature: BL-1740 The chase sweep reads the pause from its caller, never from the checkout it runs in

  Since e9f91d6746 (2026-09-21) the chase sweep holds every queued parcel
  while a control pause is active, so a bedtime or ceremony pause is never
  dead-lettered as stuck. It read that pause straight from the live
  project root, which git resolves from whatever checkout the process
  runs in. A test driving the sweep over its own fixture inbox therefore
  read the running swarm's pause, from any worktree. For as long as a
  closing ceremony held the swarm paused, every test counting chases went
  red (bl1505's property file, 07:28Z on 2026-09-25). The sweep now takes
  the pause reading from its adapters, like every other reading it makes,
  and handoffd passes the live one.

  Background:
    Given a scratch git checkout whose control pause is active
    And a fixture inbox holding one stale, unheld parcel for the coder

  # BL-1740 the-callers-pause-reading-decides-not-the-checkout-01
  Scenario Outline: the pause adapter the caller passes decides, not the checkout the sweep runs in
    When the chase sweep runs from that checkout with <pause adapter>
    Then the parcel's chase count is <count>

    Examples:
      | pause adapter                        | count |
      | no pause adapter                     | 1     |
      | a pause adapter reading false        | 1     |
      | a pause adapter reading true         | 0     |
      | handoff-lib's live pause reading     | 0     |
