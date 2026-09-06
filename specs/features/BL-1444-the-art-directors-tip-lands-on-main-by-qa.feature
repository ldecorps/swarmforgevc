# mutation-stamp: sha256=846d030b353e0c5a7682454134372ef7bf38a9f452e61f97e964e00ad9d3bf03
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-06T12:27:49.149630049Z","feature_name":"the Art Director's docs/design tip lands on main by QA on its note","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1444-the-art-directors-tip-lands-on-main-by-qa.feature","background_hash":"df487f2cc96c7c2742ad625d434515b082d6c6054542e0d831d467d765922cf3","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a tip whose own content stays inside the art director's lane merges","scenario_hash":"7e3d38641de54f910939ccbe13bcdb731f908b4c527f92cd877b69fa06fde63c","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-06T12:27:45.479833384Z"},{"index":1,"name":"a tip whose own content leaves the lane is refused naming the path","scenario_hash":"aabc7f36ddff4c4b213b7573d044afcd6e722f0738f626d314f769e0c8f50a5f","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-09-06T12:27:45.479833384Z"},{"index":4,"name":"the guard answers about a tip on request, with no merge in flight","scenario_hash":"4e3e8484d024934ccda5b92f8099dff37a41337346a8db1fa8bd7bdf5bae7274","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-06T12:27:45.479833384Z"}]}
# acceptance-mutation-manifest-end

Feature: the Art Director's docs/design tip lands on main by QA on its note

  # BL-1444 (human ruling B, 2026-09-06): primary/art-director had no path to
  # main - QA lands parcels only, the merge-up broadcast names five chain
  # roles, and the seat is not master-resident. The standing path is now: the
  # art director sends QA a note naming its tip, QA lands that tip on main
  # the way it lands a parcel, and a pre-merge-commit guard refuses the land
  # unless the tip's OWN content stays inside the art director's lane -
  # docs/design/ and its own evidence files. Content the tip merely carries
  # from the landed main (the seat merges origin/main every sweep) is exempt
  # by per-path provenance, the BL-1096 shape check_pipeline_code_on_main.sh
  # already uses. A merge whose incoming parent is reachable from the landed
  # main is never judged, so no other worktree's routine main sync is touched.
  # The hook chain is shared by every worktree (core.hooksPath), so one guard
  # covers QA's land, a coder's in-parcel merge of a brief (BL-1442), and any
  # temporary landing worktree alike. The fixture is its own repository under
  # mkdtemp, never the live one (BL-1390).

  Background:
    Given a fixture repository with a main branch, the versioned pre-merge-commit hook chain, and a branch primary/art-director based on main
    And a landing branch checked out at main's tip

  # BL-1444 docs-only-tip-lands-01
  Scenario Outline: a tip whose own content stays inside the art director's lane merges
    Given the art director's tip changes only <path>
    When the landing branch merges the tip with --no-ff
    Then the merge succeeds
    And the tip is an ancestor of the landing branch

    Examples:
      | path                                                              |
      | docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md   |
      | docs/design/system.md                                             |
      | backlog/evidence/BL-1419-art-director-20260906.md                 |

  # BL-1444 tip-outside-its-lane-refused-02
  Scenario Outline: a tip whose own content leaves the lane is refused naming the path
    Given the art director's tip changes docs/design/system.md and <path>
    When the landing branch merges the tip with --no-ff
    Then the merge is refused with a non-zero exit
    And the refusal names <path> and says an art director tip may carry only docs/design/ and its own evidence
    And the landing branch's tip is unchanged

    Examples:
      | path                                                                     |
      | extension/src/tools/render-briefing-diagrams.ts                          |
      | swarmforge/scripts/briefing_email_lib.bb                                 |
      | docs/how-to/BL-1418-the-art-director-seat-is-addressable.md              |
      | backlog/evidence/BL-1419-qa-pass-20260905.md                             |
      | backlog/paused/BL-1442-briefing-list-item-leading-ticket-id-is-bold.yaml |

  # BL-1444 main-sync-through-the-art-director-branch-unjudged-03
  Scenario: a merge of main's own tip is never judged, even after the art director merged main
    Given main gains a commit touching extension/src/ and primary/art-director merges main
    And a role worktree branch is checked out at the commit before that
    When the role worktree merges main's tip with --no-ff
    Then the merge succeeds

  # BL-1444 landed-content-carried-by-the-tip-is-exempt-04
  Scenario: content the tip carries from the landed main is exempt by provenance
    Given main gains a commit touching extension/src/ and primary/art-director merges main
    And the art director's tip changes only docs/design/system.md
    And the landing branch is still at the earlier main tip
    When the landing branch merges the tip with --no-ff
    Then the merge succeeds

  # BL-1444 direct-check-answers-before-any-merge-05
  Scenario Outline: the guard answers about a tip on request, with no merge in flight
    Given the art director's tip changes only <path>
    When the guard is asked about the tip directly
    Then it exits <exit> and prints <verdict>

    Examples:
      | path                                            | exit | verdict                  |
      | docs/design/artifact-inventory.md               | 0    | ART_DIRECTOR_TIP_OK      |
      | extension/src/tools/telegram-front-desk-bot.ts  | 1    | ART_DIRECTOR_TIP_REFUSED |

  # BL-1444 commit-not-on-the-art-director-branch-refused-06
  Scenario: asked directly about a commit that is not on primary/art-director, the guard refuses and says so
    Given a commit on a branch other than primary/art-director that changes only docs/design/system.md
    When the guard is asked about that commit directly
    Then it exits 1 and prints ART_DIRECTOR_TIP_REFUSED
    And the refusal says the commit is not on primary/art-director
