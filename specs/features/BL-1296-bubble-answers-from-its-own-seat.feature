# mutation-stamp: sha256=7c85dd7c6b1ffaef80291cb732834974145c32717d9b7e5580de1e1ad0584a2d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T12:11:47.473233833Z","feature_name":"Bubble answers from its own seat while the Cursor seat is busy","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1296-bubble-answers-from-its-own-seat.feature","background_hash":"d236707bda7d2e90512721644022d9773584fff212226d99a1930cdfd6e65237","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A seat never serves another seat's topic","scenario_hash":"8822bb14469b57dfe7aa769ea3cc436cf15ace9582f29254b9e5c0b68e70f95e","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-03T12:11:47.473233833Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble answers from its own seat while the Cursor seat is busy

  Today Bubble is a mirror topic. There is exactly ONE answering seat, the
  live Cursor agent session, and both the cursor host topic (8435) and the
  Bubble topic (11810) route to it, so whenever the Cursor seat is busy
  Bubble cannot answer - same responder, one turn at a time.

  This gives Bubble a dedicated worker of its own, riding the seat and
  lifecycle machinery BL-1235 already shipped for the local qwen seat.

  Bubble STAYS A MIRROR. The human chose the dedicated-worker shape over an
  independent responder: Bubble remains the phone view of the front desk and
  must not become a second brain with its own context that can diverge from
  what the human sees at the front desk. Parallelism is the goal; divergence
  is explicitly not.

  Background:
    Given a Bubble seat bound to the Bubble topic and a Cursor seat bound to the cursor host topic

  # BL-1296 bubble-answers-from-its-own-seat-01
  Scenario: Bubble answers while the Cursor seat is mid-turn
    Given the Cursor seat is busy with a turn that has not finished
    When a message arrives in the Bubble topic
    Then Bubble answers it without waiting for the Cursor seat to finish

  # BL-1296 bubble-answers-from-its-own-seat-02
  Scenario Outline: A seat never serves another seat's topic
    When a message arrives in the <topic> topic
    Then it is answered by the <seat> seat only
    And no other seat answers it

    Examples:
      | topic       | seat   |
      | Bubble      | Bubble |
      | cursor host | Cursor |

  # BL-1296 bubble-answers-from-its-own-seat-03
  Scenario: A Bubble seat that cannot answer says why in its own topic
    Given the Bubble seat cannot produce an answer
    When a message arrives in the Bubble topic
    Then the reason is reported in the Bubble topic
    And the turn is not handed to another seat

  # BL-1296 bubble-answers-from-its-own-seat-04
  Scenario: Adding the second seat opens no competing poller
    When the Bubble seat is running alongside the Cursor seat
    Then exactly one getUpdates owner exists

  # BL-1296 bubble-answers-from-its-own-seat-05
  Scenario: Both seats are supervised
    Given the Bubble seat has stopped unexpectedly
    When the watchdog next checks the seats
    Then it reports the Bubble seat as needing attention
