# mutation-stamp: sha256=062df0334e0120ad15137a0f9adb27f15734d2ac478e2a1914773b485e41bde1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-15T09:06:56.588128Z","feature_name":"One documented path takes a bare Linux box to an autonomous swarm","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature","background_hash":"0ef4024d0ffe53964e730c8b8a8f8a983274ed7f0caec86da11cca80ac228db1","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the autonomous path enables every unit an autonomous box needs","scenario_hash":"42124e0b9fa953c181c31c8312a18ea16903ddb4e808998006bf61187b623543","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-15T09:06:56.588128Z"},{"index":2,"name":"the autonomous path keeps the headless guarantees the secondary already has","scenario_hash":"61fb2353d7b78a8616496b639aab90f05e1547ae094d4b3ecdace504a31fa0fd","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-15T09:06:56.588128Z"},{"index":4,"name":"a swarm name that is not unique to this box is refused","scenario_hash":"62b26c21dc65f478ab5aff7fece1ccce750c2eff8dcb8b3a6057e0d5fd29aebc","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-15T09:06:56.588128Z"},{"index":5,"name":"a dry run shows the operator what would happen and changes nothing","scenario_hash":"e353c5a43fdf49b438caf9020498384574752862e4a9ed8340946d28eb473600","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-15T09:06:56.588128Z"}]}
# acceptance-mutation-manifest-end

Feature: One documented path takes a bare Linux box to an autonomous swarm

  Two provisioners exist and each holds half of what a new project on a remote box
  needs. `provision_secondary_host.sh` (BL-101) does the whole bare-host bootstrap —
  packages, substrate pinned from the lock file, the auto-updater disabled, the clone,
  headless auth — and then hardcodes the SECONDARY shape: a swarm that works only the
  tickets a primary coordinator assigned it, never promotes, never assigns, and is
  refused a coordinator window at launch. `provision_primary_host.sh` (BL-359)
  produces the units an autonomous box needs but assumes the host is already set up.

  So today an operator must hybridise: run the secondary provisioner for its substrate
  work, discard the conf and units it generated and enabled, hand-place a full pack,
  then run the primary provisioner over the result. That is error-prone precisely on
  an unattended internet-facing box, which is the case BL-101's own security posture
  takes most seriously.

  The behaviour these scenarios pin down is a SPLIT, not a third provisioner. Steps 1
  to 4 of the secondary provisioner are already shape-agnostic; only conf generation
  and the unit set branch. Whichever way the split lands — a flag or a shared library
  both provisioners call — three things must stay true: the secondary shape keeps
  working unchanged, no unit content is authored anywhere but the existing generator,
  and an operator can see what would happen to an internet-facing box before it does.

  The front desk is not an optional extra here. An autonomous swarm has its own
  Telegram channel, and the secondary provisioner installs no front-desk unit at all —
  BL-359 called that omission "exactly as dark as no unit at all". A bring-up that
  ends without it is not finished.

  Background:
    Given a bare Linux host reachable over SSH with a repo-scoped clone credential

  # BL-628 autonomous-bootstrap-01
  Scenario: the autonomous path produces a swarm that works its own backlog
    When the autonomous provisioning path is run to completion
    Then the generated conf declares an autonomous swarm, not a secondary one
    And the swarm is granted a coordinator window at launch
    And it promotes and assigns from its own backlog against its own target repo

  # BL-628 autonomous-bootstrap-02
  Scenario Outline: the autonomous path enables every unit an autonomous box needs
    When the autonomous provisioning path is run to completion
    Then the <unit> unit is installed and enabled

    Examples:
      | unit       |
      | swarm      |
      | operator   |
      | front desk |

  # BL-628 autonomous-bootstrap-03
  Scenario Outline: the autonomous path keeps the headless guarantees the secondary already has
    When the autonomous provisioning path is run to completion
    Then <headless guarantee>

    Examples:
      | headless guarantee                                                |
      | every installed substrate version came from the lock file         |
      | no install resolved a floating latest version                     |
      | the agent auto-updater is disabled for the service environment    |
      | the box relaunches its swarm after a reboot with no human action  |

  # BL-628 autonomous-bootstrap-04
  Scenario: the secondary shape still provisions exactly as it did
    Given the same inputs that provisioned a secondary box before this change
    When the secondary provisioning path is run
    Then it installs the same substrate, writes the same conf and enables the same units
    And no unit the secondary shape never had is enabled

  # BL-628 autonomous-bootstrap-05
  Scenario Outline: a swarm name that is not unique to this box is refused
    Given a swarm name that is <name defect>
    When the autonomous provisioning path is started
    Then it refuses to generate a conf
    And it reports the name as the reason
    And nothing is installed or enabled on the host

    Examples:
      | name defect                              |
      | already claimed by another live swarm    |
      | the placeholder name shipped in the pack |

  # BL-628 autonomous-bootstrap-06
  Scenario Outline: a dry run shows the operator what would happen and changes nothing
    When the autonomous provisioning path is run in dry-run mode
    Then every <action> it would perform is printed
    And no <action> is performed

    Examples:
      | action           |
      | package install  |
      | file write       |
      | unit enable      |

  # BL-628 autonomous-bootstrap-07
  Scenario: unit content has exactly one author
    When the units installed by either provisioning path are compared with the generator's output
    Then every unit was rendered by the existing unit generator
    And no provisioning path composes unit content of its own

  # BL-628 autonomous-bootstrap-08
  Scenario: the runbook says where the onboarding ceremony happens
    When the autonomous bring-up runbook is read
    Then it states that the ceremony runs on the primary box against a repository URL
    And it states that the remote box pulls the committed contract and prompts
    And it states that the contract is never negotiated on the remote box
