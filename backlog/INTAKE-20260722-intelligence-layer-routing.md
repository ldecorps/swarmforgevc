# Human directive — intelligence layer routing (operator session)
#
# **SUPERSEDED** by `INTAKE-20260722-compaction-telemetry-priority.md` (2026-07-22):
# compaction telemetry (GH-22/GH-23) now outranks ModelFactory / BL-546 S2 drain.

**From:** human (via Cursor operator session)  
**Date:** 2026-07-22  
**Authority:** operator ruling on Swarm Intelligence Layer queue

## Do now

1. **Route BL-525 (ModelFactory Slice 1) to coder immediately.** Spec is on main (`specs/features/BL-525-model-factory-role-model-assignment.feature`). Ticket is in `backlog/active/`. Do not let it sit while reliability churn continues.

2. **Specifier: drain BL-546 Slice 2** from `specs/features/BL-546-prompt-engine-slices-2-3.feature.draft` into a proper paused/ ticket + live feature file (mirror BL-556/BL-557 pattern for Model Steward). Per-model adapters are on the critical path for Qwen/Kimi onboarding.

3. **Promotion order unchanged:** BL-556 (Steward evaluate) can queue after BL-525 enters pipeline; BL-548 stays blocked until PE S2 + MS S2 land.

4. **Qwen/Kimi onboarding** is operational work after BL-525 + PE Slice 2 — not a separate epic; register/certify via Model Steward once adapters exist.
