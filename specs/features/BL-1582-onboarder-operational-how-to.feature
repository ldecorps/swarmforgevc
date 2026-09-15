Feature: BL-1582 Onboarder operational how-to

  The Onboarder's three slices are on main and it starts with every swarm
  launch, but no page tells an operator what starts it, how to see that
  it is up, where a target's state lives, how to recover a stalled
  onboarding, or how to stop it. The tutorial walks the conversation and
  the class document says what shipped; this guide is the task-oriented
  page between them, and it is only worth having if every path and file
  name in it was read off the code rather than recalled.

  Background:
    Given the Onboarder how-to page docs/how-to/BL-1582-onboarder-run-an-onboarding-end-to-end.md

  # BL-1582 onboarder-operational-how-to-01
  Scenario: the page exists and is reachable from the docs index
    When the docs index is read
    Then the how-to guides section links the page

  # BL-1582 onboarder-operational-how-to-02
  Scenario Outline: every repo path the page names resolves on disk
    When every backticked repo-relative path in the page is collected
    Then each of them resolves to a file in the repository
    And the collection holds at least 7 paths
    And the collection includes <path>

    Examples:
      | path                                                       |
      | swarmforge/scripts/launch_onboarder.sh                     |
      | swarmforge/scripts/start_ancillary_services.sh             |
      | swarmforge/scripts/stop_ancillary_services.sh              |
      | swarmforge/scripts/onboarder_supervisor.bb                 |
      | extension/src/tools/onboarder-reconcile.ts                 |
      | docs/tutorials/Onboarding-New-Project.md                   |
      | docs/explanation/BL-643-non-pipeline-agents-as-a-class.md  |

  # BL-1582 onboarder-operational-how-to-03
  Scenario Outline: every runtime file the page names is spelled as the code spells it
    When the page is read
    Then it quotes the runtime file <file>
    And the source <source> spells the same literal

    Examples:
      | file                       | source                                          |
      | onboarder-supervisor.pid   | swarmforge/scripts/launch_onboarder.sh          |
      | onboarder-supervisor.log   | swarmforge/scripts/launch_onboarder.sh          |
      | onboarder-supervisor.stop  | swarmforge/scripts/stop_ancillary_services.sh   |
      | onboarder-heartbeat.json   | extension/src/tools/onboarder-reconcile.ts      |

  # BL-1582 onboarder-operational-how-to-04
  Scenario Outline: the page walks every persisted phase and every prerequisite step
    When the page is read
    Then it names the <kind> <name>

    Examples:
      | kind              | name                   |
      | phase             | checking-prerequisites |
      | phase             | prerequisites-ready    |
      | phase             | contract-proposed      |
      | phase             | negotiating            |
      | phase             | contract-agreed        |
      | phase             | prompts-proposed       |
      | phase             | ready-to-launch        |
      | phase             | done                   |
      | prerequisite step | toolchain              |
      | prerequisite step | github-access          |
      | prerequisite step | fork-clone             |
      | prerequisite step | target-repo            |
      | prerequisite step | bot-token              |

  # BL-1582 onboarder-operational-how-to-05
  Scenario: the page hands the launch to the human and never claims the Onboarder runs the swarm
    When the page is read
    Then it states that the human runs the posted launch command on the target host
    And it states that the Onboarder never launches or observes the target swarm
