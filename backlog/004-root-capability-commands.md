Backlog Intake: Root Capability Commands

Problem

SwarmForge capabilities are currently tightly coupled to the swarm runtime. As a result, users must know whether the swarm is running before they can invoke a capability.

This creates unnecessary friction and prevents important workflows (such as assimilation) from being used when the swarm is unavailable.

Capabilities should be independent of their execution engine.

Goal

Introduce a consistent set of root-level commands that expose SwarmForge capabilities.

Each command shall automatically determine the most appropriate execution strategy:

- Swarm execution when the swarm is available.
- Standalone execution when it is not.

The operator should never need to care which mode is being used.

Proposed Commands

specify
implement
qa
document
assimilate
review
harden
status
resume
stop
doctor

Additional commands can be introduced over time without changing the architectural model.

Execution Model

Every command follows the same lifecycle:

1. Validate inputs.
2. Detect swarm availability.
3. Select the execution engine.
4. Execute the requested capability.
5. Produce the expected artefacts.
6. Report the outcome.

Conceptually:

Command
   │
   ▼
Execution Dispatcher
   │
   ├── Swarm Executor
   │
   └── Standalone Executor
            │
            ▼
Equivalent outputs

Design Principles

- Capabilities are independent of execution engines.
- The swarm is an optimisation, never a prerequisite.
- The CLI remains stable regardless of execution strategy.
- Both execution modes should produce equivalent artefacts whenever practical.
- Commands should be composable and scriptable.

Acceptance Criteria

- Root-level launcher exists for each capability.
- Commands automatically detect swarm availability.
- Swarm mode dispatches work to the swarm.
- Standalone mode executes the capability locally.
- Users invoke the same command regardless of execution mode.
- Existing workflows continue to function unchanged.

Future Enhancements

- Support remote swarm execution.
- Support cloud-hosted swarm execution.
- Pluggable execution engines.
- Parallel execution where supported.
- Common execution progress reporting.
- Shared execution telemetry and metrics.

Notes

This establishes a core architectural principle for SwarmForge:

«Capabilities define what the user wants to accomplish.»

«Execution engines determine how that capability is delivered.»

This separation makes SwarmForge more resilient, easier to test, easier to automate, and simpler for operators to use.