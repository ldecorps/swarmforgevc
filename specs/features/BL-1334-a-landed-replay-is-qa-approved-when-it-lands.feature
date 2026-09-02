Feature: BL-1334 a land-step replay is QA-approved at the moment it lands

  `is_qa_ancestor.sh` is the ONE definition of "is this sha QA-approved"
  (BL-925 invariant 2): ancestry of `swarmforge-QA`, vetoed by any bounce
  verdict on file. The land step's tip-pure replay creates a NEW commit and
  publishes it to `main`, but nothing in `land_step_lib.bb`,
  `land_step_cli.bb` or `land_main_publish.sh` advances `swarmforge-QA`. So
  QA's own approved, landed work is not in the QA ref's ancestry at the moment
  it lands, and every ancestry-based gate reads `main` as carrying unapproved
  pipeline code until some later, unrelated merge happens to close the window.

  The cost is paid in overrides. A safety gate that must be bypassed to keep
  working is a safety gate people learn to bypass.

  Background:
    Given a repository whose land step publishes tip-pure replays onto the main branch

  # BL-1334 replay-approved-without-a-later-merge-01
  # The defect assertion proper: today this only becomes true when an
  # unrelated merge later drags the commit into the QA ref's ancestry.
  Scenario: the landed replay is approved with no later merge into the QA ref
    Given the land step has replayed an approved parcel onto the main branch
    And no merge into the QA ref has happened since that land
    When the shared QA-approval predicate is asked about the landed commit
    Then it answers approved

  # BL-1334 predicate-verdict-by-commit-kind-02
  # The scope guard. Fixing scenario 01 must not turn the predicate into a
  # rubber stamp: only the commit the land step landed for an approved parcel
  # gains approval. Row 3 is BL-952's veto - reachability is not approval.
  Scenario Outline: the predicate answers <verdict> for <commit>
    Given <commit> is on the main branch
    When the shared QA-approval predicate is asked about it
    Then it answers <verdict>

    Examples:
      | commit                                            | verdict      |
      | the replay of an approved parcel                  | approved     |
      | a pipeline commit belonging to no approved parcel | not approved |
      | the replay of a parcel carrying a bounce verdict  | not approved |

  # BL-1334 deploy-gate-stops-false-refusing-03
  Scenario: the deploy gate stops refusing a freshly landed replay
    Given the land step has replayed an approved parcel onto the main branch
    When the build freshness gate reports on the main branch
    Then it reports the branch as QA-approved
    And it names no offending commit
