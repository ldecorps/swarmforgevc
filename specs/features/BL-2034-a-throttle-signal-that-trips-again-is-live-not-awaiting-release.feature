Feature: BL-2034 A throttle signal that trips again is live, not awaiting release

  BL-1981's episode stamps clearedAtIso the first time its signal clears
  and never resets it. A signal that clears and then trips again leaves the
  episode reading as awaiting release while the signal is live, so BL-1982
  can ask the human whether the swarm looks healthy while it does not. The
  episode now reads as awaiting release only while its signal is clear,
  and a second clear starts the wait again from that clear.

  Background:
    Given a fixture root with a standing-red register and a swarmforge.conf configuring an active_backlog_max_depth of 6

  # BL-2034 awaiting-release-only-while-clear-01
  Scenario Outline: an episode reads as awaiting release only while its signal is clear
    When the register goes <history>, with the depth CLI run after each change
    Then the depth CLI last printed 1
    And the throttle recommendation reports <awaiting>

    Examples:
      | history                                                            | awaiting                                             |
      | over the count threshold, under it, over it again                  | no episode awaiting release                          |
      | over the count threshold, under it, over it again, under it again  | the episode awaiting release since the second clear  |
