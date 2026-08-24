# mutation-stamp: sha256=7d40c533a693dc224697e87ffcd2d3144942b95b681a9c2621f35542d1f8e728
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T13:29:29.811417160Z","feature_name":"a routing-skip recording failure never withholds delivery","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-748-routing-skip-recording-failure-never-withholds-delivery.feature","background_hash":"46ade7548f28d869073369d8ab1ee4b97350d1e65039e1c687394d47e15f3c0a","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a journal write failure degrades to a warning and the send completes","scenario_hash":"a16a1c997148652b752fa9d39c14676c1116871dc8da7c2c94c69fafca4d5498","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-24T13:29:29.811417160Z"}]}
# acceptance-mutation-manifest-end

Feature: a routing-skip recording failure never withholds delivery

  swarm_handoff.bb's -main binds, in one `let` and therefore in strict order:
  the durable outbox write (write-handoff!), then the routing-skip journal
  append (log-routing-skip!), then the real-time tmux injection that wakes the
  recipient (try-sync-deliver!). Only after all three does it consume the draft.

  log-routing-skip! writes .swarmforge/routing-skips.jsonl via fs/create-dirs
  and spit, and neither it nor its call site has any try/catch. -main has none
  either, and it is invoked bare at the bottom of the file. So any I/O failure
  in the journal append - unwritable directory, unwritable file, full disk -
  propagates out of the whole `let`: the recipient never gets their real-time
  wake, the draft file is never consumed, and the process dies on an uncaught
  exception trace instead of a controlled message. The parcel itself survives,
  because it was durably written to the outbox one binding earlier, so the
  daemon's backup mailbox path eventually delivers it - but late, and only
  after an unexplained crash.

  Recording is observational. It must never be able to withhold delivery. The
  precedent is in the same file, twelve lines above the defect: try-sync-deliver!
  already wraps its own risky work, reports the failure on stderr, and returns a
  sentinel so the caller keeps going. The journal append needs the same posture.

  Background:
    Given required-stages routing is enabled
    And an active ticket declaring required_stages and stage_skip_reasons

  # BL-748 recording-failure-still-delivers-01
  Scenario Outline: a journal write failure degrades to a warning and the send completes
    Given the active ticket declares required_stages of coder and qa
    And <journal fault>
    When the coder sends a git_handoff addressed directly to QA
    Then the send does not abort with an uncaught exception
    And the parcel is delivered to QA
    And the draft file is consumed
    And the recording failure is reported on stderr

    Examples:
      | journal fault                                                  |
      | the routing-skips journal's parent directory cannot be created |
      | the routing-skips journal file cannot be appended to           |

  # BL-748 writable-journal-unchanged-02
  Scenario: a writable journal still records the skip and delivers as before
    Given the active ticket declares required_stages of coder and qa
    And the routing-skips journal is writable
    When the coder sends a git_handoff addressed directly to QA
    Then a routing-skips journal line is appended for the ticket
    And the parcel is delivered to QA
    And no recording failure is reported on stderr

  # BL-748 guard-scoped-to-recording-03
  Scenario: a hop that records nothing is unaffected by an unwritable journal
    Given the active ticket declares the full canonical chain
    And the routing-skips journal's parent directory cannot be created
    When the documenter sends a git_handoff addressed to QA
    Then the parcel is delivered to QA
    And no recording failure is reported on stderr
