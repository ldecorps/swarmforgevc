# Model Intelligence Layer prioritization — 2026-07-22

## Priority queue reordered for Model Factory and Prompt Calibration

Per operator ruling 2026-07-22 (BL-545 Swarm Intelligence Layer):
> BL-546 → BL-551 → BL-547 → BL-525 → BL-548

Execution status:
- **BL-546** ✓ DONE (PromptEngine)
- **BL-551** 🔄 ACTIVE (LLM cost ledger) — URGENT forward sent to cleaner 14:04:08 UTC
- **BL-547** ✓ DONE (Model Steward)
- **BL-525** prioritized: `priority: 12 → 02` (Model Factory, next in queue)
- **BL-548** prioritized: `priority: 13 → 03` (Prompt Calibration, follows BL-525)

## Action taken

Elevated BL-525 and BL-548 to top-of-queue priorities (02, 03) so they are promoted
immediately when BL-551 completes the full pipeline (cleaner → architect → hardener →
documenter → QA). Respect operator's fixed order: no other paused items with higher
priority (00, 01) will jump ahead during BL-551's processing.

## Operator order rationale (from backlog context)

- BL-551 (cost ledger) must land BEFORE Model Steward/Factory work so those stages
  have real spend data to work with — not placeholder costs
- BL-547 (Model Steward) already done; Model Factory builds on it
- BL-525+548 form the core model-assignment and calibration closed-loop
- Together they unlock cost-aware model scheduling and prompt optimization

Both tickets have `human_approval: approved` and are ready to promote on first slot open.
