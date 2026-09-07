# mutation-stamp: sha256=c6f4cbcf2908412371cb75287dc0f27d6c33d7967d10fb7ed5c52243c4d8fcc9
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T11:27:45.832109554Z","feature_name":"BL-1447 A replay tip missing any path the parcel changed is refused before it is published","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1447-a-replay-missing-a-parcel-path-is-refused-before-publish.feature","background_hash":"59a281a2988801420669fec0457f4051a6d2e651aac99549eeb2dd95726e978c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a replay whose tree lacks any path the parcel changed is refused before publish, every missing path in one report","scenario_hash":"df26fa231c1b7c48eb0354e9a0c4b08b5f1d7d81ce345d8a5c326200622a9581","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-07T11:27:45.832109554Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1447 A replay tip missing any path the parcel changed is refused before it is published

  The land step's replay builds a tip-pure commit from the paths it
  attributes to the parcel and hands it to the publisher as LAND_REPLAY.
  Nothing checks that the built tip actually carries the parcel's work:
  on 2026-09-06 BL-1424's replay held five evidence files and none of its
  guard, and LAND_PUBLISHED printed for a main tip that lacked the
  deliverable (incident evidence
  backlog/evidence/BL-1424-land-replay-dropped-own-paths-incident-20260906.md).
  QA caught it only by diffing the replay against the ticket's own file list
  by hand. This feature is the fail-closed net BL-1446's root-cause fix does
  not replace: before the land step reports LAND_REPLAY it compares the
  replay tip, path by path, against the cited tip for every path the
  parcel's own commits changed since its first hop, and a mismatch is
  LAND_ESCALATE with the reason replay-incomplete naming every missing
  path - nothing is published. Every scenario runs against a fixture
  repository under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, and a parcel branch carrying five stage commits for one ticket whose last hop is recorded in the handoff archive
    And an unlanded sibling commit sits inside the parcel's own range so the land step must replay

  # BL-1447 an-incomplete-replay-is-refused-naming-every-missing-path-01
  Scenario Outline: a replay whose tree lacks any path the parcel changed is refused before publish, every missing path in one report
    Given the attribution seam drops <count> of the parcel's paths from the replay
    When the land step plans the parcel's tip
    Then the verdict is LAND_ESCALATE with reason replay-incomplete naming every dropped path
    And LAND_REPLAY is not printed
    And origin/main is unchanged

    Examples:
      | count |
      | 1     |
      | 2     |

  # BL-1447 a-complete-replay-publishes-as-before-02
  Scenario: a replay that carries every path the parcel changed is reported as LAND_REPLAY as before
    When the land step plans the parcel's tip
    Then the verdict is LAND_REPLAY
    And the replay tip carries every path the five stage commits changed, byte-identical to the cited tip
