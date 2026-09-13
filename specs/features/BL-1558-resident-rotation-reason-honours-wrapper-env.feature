Feature: BL-1558 A resident-invoked rotation keeps the wrapper's rotation reason

  ready_for_next.sh hands rotate_to_role.sh a SWARMFORGE_ROTATION_REASON of
  rotate-home (BL-550) or rotate-forward (hotfix 92ecf4aea3), and
  extension/src/metrics/rotationDynamics.ts counts stranded time only on
  rotate-home events. But respawn-as! calls rotate-resident-to! with the
  literal reason "handoff-forward", and rotate-resident-to! prefers an
  explicit reason over the env var, so every resident-invoked rotation is
  logged as handoff-forward: 0 of 1043 September 2026 rotation rows read
  rotate-home and none can ever read rotate-forward. The wrapper's label must
  reach the telemetry row; a direct `rotate_to_role.sh <role>` call with no
  env label keeps handoff-forward, and the daemon's chase rotation keeps its
  own default.

  # BL-1558 resident-rotation-reason-01
  Scenario Outline: the resident-invoked entry labels the rotation event with the wrapper's reason when one is set
    Given the resident-invoked rotation entry runs with SWARMFORGE_ROTATION_REASON <env>
    When the rotation succeeds
    Then the appended rotation event carries reason <logged>

    Examples:
      | env            | logged          |
      | rotate-home    | rotate-home     |
      | rotate-forward | rotate-forward  |
      | unset          | handoff-forward |
      | blank          | handoff-forward |

  # BL-1558 resident-rotation-reason-02
  Scenario: the daemon-driven chase rotation keeps its default label
    Given the daemon's chase rotation calls the rotation core with no explicit reason and no env label
    When the rotation succeeds
    Then the appended rotation event carries reason rotate
