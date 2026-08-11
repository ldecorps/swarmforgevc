# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-11T20:03:36.986573Z","feature_name":"A ticket's own bounce record keeps every distinct same-day bounce","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-876-bounce-history-keeps-every-distinct-same-day-bounce.feature","background_hash":"126e84970b589d7206d9ea6ec9b728721bc5a7fb81ab28eaff5f650f89ce0ff0","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: A ticket's own bounce record keeps every distinct same-day bounce

  The ticket YAML's bounce_history is the only instrument the lifecycle
  ledger reads for bounce events, so a bounce it collapses is lost to every
  consumer even though the JSONL bounce store still holds it. Two bounces
  the store keeps apart must stay apart here too, and only a bounce
  identical in every field is still folded away.

  Background:
    Given a bounce recorded against the ticket on 2026-08-07 for failure class "behavior" by "architect" citing commit "a6f61c2895"

  # Hardener (BL-234 equivalent-mutant note, 2026-08-11): a hard Gherkin
  # mutation pass single-character-mangles each <commit> example value (4
  # mutants: 1 killed, 3 survived). The killed mutant is row 4 (architect /
  # a6f61c2895 / size 1) - that row's whole point is an EXACT duplicate of
  # the Background bounce, so mangling its commit turns it into a genuinely
  # distinct bounce and the expected size flips from 1 to 2, catching it.
  # The 3 survivors (rows 1-3) are all rows already made distinct from the
  # Background entry by construction - either a different `by` or an
  # already-different `commit` - so entryNaturalKey's equality check (the
  # only thing this scenario's own size/count assertions can ever observe)
  # returns "not equal" both before and after a single-character mangle:
  # the mutated commit is still unequal to the Background's a6f61c2895. No
  # assertion targeting this feature's own invariant (does a same-day
  # same-class bounce get kept or collapsed) could ever distinguish the two
  # strings without asserting the literal commit content, which is already
  # exhaustively covered at the unit layer by
  # bounceHistory.property.test.js's "every appended entry round-trips:
  # parse recovers each field verbatim" (fast-check over arbitrary commit
  # strings) - adding a redundant content check here would test storage
  # fidelity a second time, not this feature's dedup behaviour. No
  # artificial assertion was added to force the 3 survivors to die.
  # BL-876 bounce-history-same-day-rebounce-01
  Scenario Outline: A same-day same-class bounce is kept unless it is identical
    When a bounce is recorded on 2026-08-07 for failure class "behavior" by "<by>" citing commit "<commit>"
    Then the ticket's own record carries a bounce history of size <size>, oldest first
    And the ticket's own record carries a bounce count of <size>

    Examples:
      | by        | commit     | size |
      | architect | ac7174a19c | 2    |
      | QA        | a6f61c2895 | 2    |
      | QA        | 8ac82a0e00 | 2    |
      | architect | a6f61c2895 | 1    |

  # BL-876 bounce-history-same-day-rebounce-02
  Scenario: A third distinct bounce on the same day and class is appended too
    Given a bounce recorded against the ticket on 2026-08-07 for failure class "behavior" by "QA" citing commit "8ac82a0e00"
    When a bounce is recorded on 2026-08-07 for failure class "behavior" by "hardender" citing commit "ac7174a19c"
    Then the ticket's own record carries a bounce history of size 3, oldest first
    And the ticket's own record carries a bounce count of 3
