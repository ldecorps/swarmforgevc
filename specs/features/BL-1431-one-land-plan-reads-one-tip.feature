Feature: BL-1431 One land plan reads one tip

  The land step (land_step_cli.bb, land_step_lib.bb) decides whether a
  QA-approved tip may land by walking origin/main..tip: which commits are
  another ticket's, which delivered paths belong to whom, which siblings
  are already landed. On a QA branch that walk takes about four minutes.
  During it the daemon's push sweep, the periodic pull and the sync CLI all
  run git fetch origin main on the shared repository, and the library
  resolves origin/main by name in several places inside one plan: land-plan
  resolves it once, entangled-siblings resolves it again, own-paths
  resolves it a third time. When the ref moves between two of those reads,
  own-paths diffs against a newer tip than the attribution map was built
  on, a freshly minted ticket file appears as a delivered path with no
  attribution, and the plan escalates with "land-step: could not read
  <path>'s attribution". On 2026-09-05 that stopped BL-1416's land twice
  (BL-1426's ticket, then BL-1428's topic record) and BL-1407's once, each
  time naming an unrelated ticket that had merely landed on main mid-walk.

  This feature is that origin/main is resolved by name exactly once per
  land-step invocation, at entry, and every read the plan makes takes that
  SHA; a fetch that moves the ref mid-walk changes nothing about the
  verdict, and the publish's own FF-only push with its single rematch
  remains the place a moved origin is reconciled (BL-1144). Every scenario
  runs against a fixture repository under a temporary directory with its
  own bare origin, never the live checkout.

  Background:
    Given a fixture repository with a bare origin, a landed main, and a QA-style branch carrying one approved parcel

  # BL-1431 a-tip-that-moves-mid-walk-changes-nothing-01
  Scenario: origin/main advancing during the attribution walk does not change the verdict
    Given origin/main advances by an unrelated mint commit the first time the attribution walk reads a path
    When the land plan for the parcel is computed
    Then its verdict and its own paths equal those of the same plan computed with origin/main held still
    And no path is reported as unreadable

  # BL-1431 the-tip-is-resolved-once-per-invocation-02
  Scenario: origin/main is resolved by name once per invocation and threaded to every read
    When the land step computes a plan against the fixture
    Then origin/main is resolved by name exactly once
    And every candidate, delivered-path, attribution and landed-sibling read takes that SHA

  # BL-1431 an-unresolvable-tip-still-fails-open-03
  Scenario: an origin/main that cannot be resolved at entry is still the fail-open warning
    Given the fixture has no origin/main ref
    When the land plan for the parcel is computed
    Then the plan warns that origin/main could not be resolved
    And it names no guessed SHA

  # BL-1431 a-moved-origin-is-reconciled-at-the-push-04
  Scenario: a moved origin after the plan is reconciled by the single rematch at the push
    Given the plan produced a replay commit and origin/main then advanced by an unrelated mint
    When land_main_publish.sh pushes the replay
    Then it rematches once onto the current tip and publishes
    And it never rematches twice and never forces
