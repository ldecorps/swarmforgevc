# mutation-stamp: sha256=0808d58812fb788829ec69093547f3777c6fa87a56cfd6690193af21dc50aa15
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T01:52:01.119416914Z","feature_name":"BL-1339 a land-approval record lands where the predicate reads it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1339-a-land-approval-record-lands-where-the-predicate-reads.feature","background_hash":"aca64171dc43e33f6e85e4866935a596f2c7db2d7187435fe763192f1a234cf9","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a land step run from <checkout> records into the one shared store","scenario_hash":"ce06b637de7f33f4e3da9704be99c0d4ee414dcc08247767a31368c73ac177e4","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-03T01:52:01.119416914Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1339 a land-approval record lands where the predicate reads it

  BL-1334 made the land step record WHICH approved source each tip-pure
  replay stands in for, so `is_qa_ancestor.sh` can grant approval to a
  commit no ref has yet reached. The record is written under
  `.swarmforge/land-approvals/` relative to the root the land step resolved
  for itself, and the land step resolves that root from its own working
  directory.

  A pipeline role only ever stands in a linked worktree, so the record is
  written into that worktree. Every consumer of the predicate - handoffd's
  push sweep, the babysitter's Article 4.2 sweep, the deploy freshness gate -
  asks from the target root, where the machine-local verdict stores actually
  live. The record and the reader never meet.

  Nothing reports this. An absent store means "no record" by design, so the
  predicate falls straight through to plain ancestry: exactly the behaviour
  BL-1334 set out to remove, with a shipped, fully-gated fix on file saying
  it was removed.

  Background:
    Given a repository with a main checkout and a linked worktree for a pipeline role
    And an approved parcel with no bounce verdict on file

  # BL-1339 land-approval-record-one-location-01
  # The location assertion proper. The store's path must not depend on which
  # checkout the land step happened to be invoked from - the two answers are
  # the same directory, or the record is unreachable from one of them.
  Scenario Outline: a land step run from <checkout> records into the one shared store
    Given the land step is run from <checkout>
    When it replays the approved parcel onto the main branch and records the approval
    Then the approval record is in the shared root's land-approval store

    Examples:
      | checkout            |
      | the main checkout   |
      | the linked worktree |

  # BL-1339 land-approval-record-one-location-02
  # One store, not two that agree. A per-worktree copy would satisfy 01 by
  # accident while still leaving the reader a store it can miss.
  Scenario: a land step run from the linked worktree creates no store there
    Given the land step is run from the linked worktree
    When it replays the approved parcel onto the main branch and records the approval
    Then the linked worktree has no land-approval store of its own

  # BL-1339 land-approval-record-one-location-03
  # BL-1334's own invariant 1, asked of the topology that actually occurs:
  # the land step is run by QA, from QA's worktree, never from the main
  # checkout.
  Scenario: the predicate grants the landed replay with no later merge
    Given the land step is run from the linked worktree
    And it replays the approved parcel onto the main branch and records the approval
    And no merge into the QA ref has happened since that land
    When the shared QA-approval predicate is asked about the landed commit from the shared root
    Then it answers approved

  # BL-1339 land-approval-record-one-location-04
  # Append, never truncate - BL-1334's stated store discipline, now across
  # checkouts. A land from one checkout must not erase the other's record.
  Scenario: a land from either checkout appends beside the other's record
    Given a land-approval record written by a land step run from the main checkout
    And the land step is run from the linked worktree
    When it replays a second approved parcel onto the main branch and records the approval
    Then both approval records are in the shared root's land-approval store

  # BL-1339 land-approval-record-one-location-05
  # The scope guard. Moving the store must not turn the predicate into a
  # rubber stamp: a record grants approval only while the source it names is
  # itself approved (BL-952 - reachability is not approval), and BL-952's own
  # sequence is approve, land, then bounce.
  Scenario: a record whose source is bounced afterwards grants nothing
    Given the land step is run from the linked worktree
    And it replays the approved parcel onto the main branch and records the approval
    And a bounce verdict is then recorded against that parcel
    When the shared QA-approval predicate is asked about the landed commit from the shared root
    Then it answers not approved

  # BL-1339 land-approval-record-one-location-06
  # Fail closed on an unresolvable shared root (BL-925 invariant 3). An
  # unrecorded land degrades to the sanctioned override, never to a guessed
  # path and never to a wrong approval - and it is reported, not silent.
  Scenario: an unresolvable shared root writes nothing and reports it
    Given the land step is run from the linked worktree
    And the shared root cannot be resolved
    When it replays the approved parcel onto the main branch and records the approval
    Then no approval record is written anywhere
    And the land step reports the approval as unrecorded
    And the land step still succeeds
