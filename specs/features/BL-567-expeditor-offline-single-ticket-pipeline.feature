Feature: Expeditor - drive one ticket through every gate with the swarm stopped

  # BL-567. The recovery path: when the swarm's own machinery is what is broken,
  # the fix cannot ride the pipeline it is fixing. The expeditor is program-driven
  # where the mono-router is event-driven - same role hats, same gates, transport
  # and liveness machinery replaced by plain control flow. It may consume durable
  # DATA under git; it may never invoke handoffd, the mailboxes, tmux, rotation,
  # the coordinator, chase, the babysitter or the operator runtime.
  #
  # Lifecycle is in scope (operator ruling 2026-07-25): park-and-stop is the
  # initiation and BLOCKS; restart is a final phase and must NOT block, because
  # the start path may itself be what is under repair.
  #
  # Epic swarm-reliability. Design: backlog/evidence/BL-567-design-20260725.md

  Background:
    Given a repo with no live swarm and a fixture ticket in backlog/active/

  # BL-567 traverse-every-gate-with-swarm-down-01
  Scenario: a ticket reaches done through every gate with no swarm running
    When the expeditor runs the fixture ticket
    Then the run produces a Gherkin spec, code with tests, a review verdict, hardening evidence, docs and a QA stamp
    And the fixture ticket's yaml has moved to backlog/done/
    And the run never read or wrote any path under .swarmforge/handoffs/
    And the run never spawned a tmux process

  # BL-567 machinery-avoidance-is-instrumented-02
  Scenario: machinery avoidance is asserted by instrumentation rather than inspection
    Given the expeditor runs under a wrapper that fails on any forbidden syscall target
    When the expeditor runs the fixture ticket
    Then the wrapper reports zero touches of .swarmforge/handoffs/ and zero tmux invocations
    And the assertion comes from the wrapper's own record and not from reading the driver source

  # BL-567 forbidden-dependency-set-is-asserted-03
  Scenario: the driver still completes when every forbidden tool is absent
    Given handoffd, swarm_handoff.bb, rotate_to_role and tmux are stubbed to fail on invocation
    When the expeditor runs the fixture ticket
    Then the run reaches done without invoking any stubbed tool
    And no stubbed tool recorded an invocation

  # BL-567 qa-failure-loops-back-to-coder-04
  Scenario: a seeded QA failure sends the ticket back to the coder stage
    Given the fixture ticket's QA gate is seeded to fail once
    When the expeditor runs the fixture ticket
    Then the driver re-enters the coder stage carrying the QA failure reason
    And the ticket still reaches done after the rework passes QA

  # BL-567 bounce-bound-exhausts-loudly-05
  Scenario: exhausting the bounce bound exits non-zero naming the failed gate
    Given the fixture ticket's architect gate is seeded to fail every time
    When the expeditor runs the fixture ticket
    Then the driver stops after three bounces against that gate
    And the exit status is non-zero and the message names the architect gate
    And the driver never loops without bound

  # BL-567 exhaustion-reports-a-probable-spec-defect-05b
  Scenario: exhausting the bound reports a probable spec defect rather than a coder failure
    Given the fixture ticket's architect gate is seeded to fail every time on one concern
    When the expeditor runs the fixture ticket
    Then the run record names the repeated defect class across the three rounds
    And the run record marks the ticket as a probable spec defect for the specifier
    And the report does not attribute the failure to the coder stage

  # BL-567 raised-bound-is-explicit-and-recorded-05c
  Scenario: raising the bounce bound above the default is explicit and recorded
    Given the expeditor is invoked with a bounce bound above the default
    When the expeditor runs the fixture ticket
    Then the run record states the bound in force and that it was raised explicitly
    And the default bound remains three when no bound is given

  # BL-567 bounce-never-reverts-the-branch-06
  Scenario: a bounce records a verdict and does not revert the working branch
    Given the fixture ticket's architect gate is seeded to fail once
    When the expeditor runs the fixture ticket
    Then the bounced commit remains reachable from the expeditor branch tip
    And the driver recorded a bounce verdict naming the target stage

  # BL-567 expedited-marker-on-every-commit-07
  Scenario: commits from an expedited run are auditable as offline-run
    When the expeditor runs the fixture ticket
    Then every commit the run produced carries the expedited marker
    And those commits passed the same lint, test and mutation gates the online pipeline enforces

  # BL-567 dedicated-branch-never-main-08
  Scenario: the run works on its own branch and worktree and never commits to main
    When the expeditor runs the fixture ticket
    Then the stage commits landed on the run's own expedite branch
    And no commit landed on main outside the QA stage's merge
    And the run did not commit inside any .worktrees role checkout

  # BL-567 refuses-a-live-swarm-09
  Scenario: the expeditor refuses to start while a swarm is genuinely live
    Given a live swarm whose tmux server answers and whose handoffd pid is running
    When the expeditor is asked to run the fixture ticket
    Then the expeditor refuses with a message naming the live swarm
    And no stage session was spawned

  # BL-567 stale-socket-file-is-not-liveness-10
  Scenario: a leftover socket file with no server does not read as a live swarm
    Given a stopped swarm whose tmux socket file still exists with no server answering
    When the expeditor is asked to run the fixture ticket
    Then the expeditor treats the swarm as stopped and proceeds
    And the expeditor did not require the override flag

  # BL-567 override-bypasses-loudly-11
  Scenario: the override flag bypasses the live-swarm refusal with a warning
    Given a live swarm whose tmux server answers and whose handoffd pid is running
    When the expeditor is asked to run the fixture ticket with the override flag
    Then the expeditor proceeds and emits a warning naming the override
    And the override use is recorded in the run record

  # BL-567 initiation-parks-active-to-hold-12
  Scenario: initiation parks an active ticket to hold rather than paused
    Given a second ticket already sitting in backlog/active/
    When the expeditor initiates a run for the fixture ticket
    Then the second ticket's yaml has moved to backlog/hold/
    And no ticket was moved to backlog/paused/
    And a park record names the parked ticket's per-role branch tips and any claimed parcel

  # BL-567 initiation-preserves-parcels-and-worktrees-13
  Scenario: initiation never sweeps the inbox or resets worktrees
    Given pending parcels in two role mailboxes and local commits on a role branch
    When the expeditor initiates a run for the fixture ticket
    Then both role mailboxes still hold their pending parcels
    And each role branch still points at the commit it pointed at before initiation

  # BL-567 lying-teardown-refuses-the-run-14
  Scenario: a teardown that reports success with a survivor makes the expeditor refuse
    Given a stop path that exits zero while a babysitter process is still running
    When the expeditor initiates a run for the fixture ticket
    Then the expeditor refuses with a message naming the surviving process
    And the expeditor did not proceed to any stage

  # BL-567 stage-timeout-fails-loudly-15
  Scenario: a stage that hangs past its bound ends in a loud terminal failure
    Given the coder stage is seeded to hang past its configured timeout
    When the expeditor runs the fixture ticket
    Then the driver terminates the stage and exits non-zero naming the coder stage
    And the driver does not wait indefinitely with no supervisor alive

  # BL-567 restart-failure-keeps-the-done-verdict-16
  Scenario: a failed restart does not retract a ticket that already passed QA
    Given the full-stack start path is seeded to fail
    When the expeditor runs the fixture ticket to done and then restarts the stack
    Then the fixture ticket's yaml is still in backlog/done/
    And the result distinguishes the ticket verdict from the restart outcome
    And the restart failure is reported loudly

  # BL-567 restart-uses-the-full-stack-path-17
  Scenario: the restart phase brings back ancillaries and reports the live-set delta
    When the expeditor runs the fixture ticket to done and then restarts the stack
    Then the restart invoked the full-stack start path and not the pipeline-only one
    And the report states the delta between the observed live set and the expected one
    And the report does not assert health it did not observe

  # BL-567 restart-reports-parked-work-without-promoting-18
  Scenario: the restart reports parked tickets instead of silently re-promoting them
    Given a second ticket parked to backlog/hold/ during initiation
    When the expeditor runs the fixture ticket to done and then restarts the stack
    Then the report names the ticket left in backlog/hold/ and what it was holding
    And that ticket is still in backlog/hold/ after the restart
