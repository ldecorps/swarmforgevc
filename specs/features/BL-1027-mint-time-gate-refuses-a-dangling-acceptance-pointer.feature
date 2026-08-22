Feature: the specifier's hygiene gate refuses a ticket whose acceptance pointer names a file that is not there

  # BL-1027. The existence check already exists twice, and neither copy runs
  # early enough. BL-880 arms it at every pre-QA git_handoff hop, coder
  # onward - so it fires only after a ticket has been promoted and picked
  # up. BL-626 arms it at promotion. A ticket that is never promoted is
  # checked by neither, and sits in paused/ advertising an acceptance
  # contract that does not exist.
  #
  # Measured 2026-08-21, not predicted: BL-579 and BL-580 - both
  # human-requested and human-approved on 2026-07-23 - had pointed at
  # feature files nobody had written for close to a month, and BL-1025 was
  # filed the same way the same week. All three would have bounced within a
  # minute of promotion (BL-314) and hard-failed the acceptance runner.
  # None of the three was ever promoted, so BL-626's gate would not have
  # caught any of them.
  #
  # This is the same "catch it HERE, at mint/hygiene-gate time, instead of
  # five stages later" move BL-922 already made in this gate for the
  # block-scalar shape, extended to the shape that actually bit. Which
  # declarations are checkable is NOT re-decided here: the pre-QA hop's
  # predicate is the one point of truth, so the two can never drift into
  # disagreeing about the same ticket (BL-897).

  Background:
    Given a ticket the specifier is about to hand off

  # BL-1027 declaration-shape-decides-the-verdict-01
  Scenario Outline: only a pointer that names a missing file is refused
    Given the ticket's acceptance declaration <declaration>
    When the specifier's backlog hygiene gate runs on it
    Then the gate <verdict>

    Examples:
      | declaration                                        | verdict                                    |
      | names a feature file that is present               | passes it                                  |
      | names a feature file that is not present           | refuses it, naming the ticket and the path |
      | names a parked draft file that is present          | passes it                                  |
      | is absent altogether                               | passes it                                  |
      | is a block scalar naming no feature file           | passes it                                  |
      | is a glob-shaped mention of a file not yet named   | passes it                                  |
      | is an epic tracker's prose standing in for a path  | passes it                                  |

  # BL-1027 one-bad-ticket-is-not-masked-by-good-ones-02
  Scenario: a run over several tickets reports the bad one rather than the first verdict
    Given several tickets, one of which names a feature file that is not present
    When the specifier's backlog hygiene gate runs on all of them
    Then the gate refuses, naming the offending ticket
    And the tickets that are clean are not named as offenders

  # BL-1027 the-existing-block-scalar-check-still-fires-03
  Scenario: the check BL-922 already put here is not displaced by the new one
    Given the ticket's acceptance declaration is a block scalar hiding a real feature path
    When the specifier's backlog hygiene gate runs on it
    Then the gate refuses it as an unreadable acceptance declaration
