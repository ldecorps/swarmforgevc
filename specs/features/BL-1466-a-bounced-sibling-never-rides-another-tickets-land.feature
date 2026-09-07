# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T15:28:36.067029136Z","feature_name":"BL-1466 A bounced sibling never rides another ticket's land until it is re-fixed","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1466-a-bounced-sibling-never-rides-another-tickets-land.feature","background_hash":"db969aed4f6155f26855a765729451c240c19fbf827e20384ca6773be05e1107","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1466 A bounced sibling never rides another ticket's land until it is re-fixed

  BL-1375 lets approved siblings sharing a path land together and decides
  who may ride from the sibling's backlog folder and human_approval. A
  bounce changes neither: the ticket stays approved and active while QA's
  revert keeps the bounced content out of QA's own tree. BL-1438's re-point
  then resets that tree to origin/main after every land, dropping the
  revert, and the next parcel sharing history with the bounced ticket
  brings the bounced content back on merge. On 2026-09-07 BL-1450 was
  bounced at 11:48Z, its revert dropped by the re-point after BL-1447's
  land, and BL-1452's documenter tip carried BL-1450's original content
  back into the QA branch; BL-1452 shared no path with it, so nothing rode,
  and QA found it by hand. A sibling whose most recent bounce is newer than
  its most recent handoff is not a landable sibling, whatever its
  human_approval says, and the land step says so. Every scenario runs
  against a fixture repository under mkdtemp with its own origin and its
  own bounce store (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a landing ticket, and an approved sibling ticket sharing a path with it

  # BL-1466 a-sibling-bounced-after-its-last-handoff-is-blocking-and-named-01
  Scenario: a sibling bounced after its last handoff is blocking and named
    Given the sibling's most recent bounce record names a commit reachable from the landing tip and no later handoff of the sibling exists
    When the land step plans the landing ticket's tip
    Then the sibling is reported as blocking, naming the bounce and its commit
    And no path the sibling owns rides the replay and the sibling is not a passenger

  # BL-1466 a-sibling-re-fixed-after-its-bounce-is-approved-again-02
  Scenario: a sibling re-fixed after its bounce is approved again
    Given the sibling's most recent bounce record is older than a later handoff of the sibling citing a descendant of the bounced commit
    When the land step plans the landing ticket's tip
    Then the sibling's approval state is approved and it may ride as a passenger as before

  # BL-1466 an-unreadable-bounce-store-blocks-rather-than-passes-03
  Scenario: a bounce store that cannot be read blocks rather than passes
    Given the bounce store for the current month is unreadable
    When the land step plans the landing ticket's tip
    Then the sibling's approval state is unreadable and blocking, naming the store

  # BL-1466 a-sibling-with-no-bounce-record-is-judged-as-before-04
  Scenario: a sibling with no bounce record is judged exactly as BL-1375 judged it
    Given no bounce record names the sibling
    When the land step plans the landing ticket's tip
    Then the sibling's approval state is exactly what BL-1375 gives it
