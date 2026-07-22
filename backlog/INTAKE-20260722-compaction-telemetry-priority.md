# Human directive — compaction telemetry immediately after BL-525

**From:** human (via Cursor operator session)  
**Date:** 2026-07-22  
**Authority:** amends `INTAKE-20260722-compaction-telemetry-priority.md`

## Promotion / implementation order

1. **BL-525 (ModelFactory Slice 1)** — stays **active**; coder implements now.
2. **GH-22 → GH-23** — **right after BL-525** clears `active/`:
   - Specifier may drain GH-22/GH-23 from backlog root to `paused/` **in parallel** while coder works BL-525 (prep specs early).
   - Coordinator promotes **GH-22 first, then GH-23** as soon as BL-525 lands in `done/` — ahead of other Model-layer work.
3. **Defer** BL-548, BL-546 Slice 2, BL-556, Qwen/Kimi onboarding until GH-22 at minimum is through the forward pipeline.

## Goal

Finish ModelFactory cold-swap, then crack compaction with telemetry + dashboard before resuming the rest of the intelligence layer.
