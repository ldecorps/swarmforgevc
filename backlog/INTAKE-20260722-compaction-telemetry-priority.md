# Human directive — compaction telemetry beats ModelFactory queue

**From:** human (via Cursor operator session)  
**Date:** 2026-07-22  
**Authority:** supersedes `INTAKE-20260722-intelligence-layer-routing.md` for promotion order

## Priority (effective immediately)

1. **Specifier drains backlog root GH-22 and GH-23 first** — before any ModelFactory / PromptEngine Slice 2 / BL-546 adapter work.
   - **GH-22** (priority 01): telemetry for compaction + context utilisation — foundation.
   - **GH-23** (priority 02): Console Mini App context-budget dashboard — depends on GH-22 signals.

2. **Park Model intelligence layer work:**
   - **BL-525** moved back to `paused/` — do not promote until GH-22 at minimum is specced and in pipeline.
   - **BL-548** stays paused.
   - **BL-546 Slice 2** ticket drain is **deferred** until GH-22/GH-23 are specced into `paused/`.

3. **Coder:** release any in-flight BL-525 claim; rotate resident to **specifier** when actionable mail exists so root intakes drain.

4. **Goal:** crack the compaction discussion with measurable telemetry before resuming ModelFactory / Qwen-Kimi onboarding.
