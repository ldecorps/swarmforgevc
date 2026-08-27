# Call-site tracing before guardrail-gap nit-downgrade (BL-749)

## Rule

When a review hat (cleaner, hardener, or `/pilot` wearing those hats) notices
a missing guard that the **ticket's own text** explicitly promises (e.g.
"record-write failure must not block the send"), do **not** label it a
non-blocking nit until the **call site** has been read — not only the
function in isolation — and the downstream consequence confirmed or ruled out.

## Where it lives

| Surface | Location |
| --- | --- |
| Cleaner role prompt | `swarmforge/roles/cleaner.prompt` — section BL-749 |
| Hardener role prompt | `swarmforge/roles/hardender.prompt` — section BL-749 |
| `/pilot` brief | `composePilotExpeditorPrompt` in `telegramCursorBridgePilot.ts` |

Companion remaining-work fix for the BL-623 incident:
[BL-748](BL-748-routing-skip-recording-failure-never-withholds-delivery.md).

Acceptance:
`specs/features/BL-749-pilot-guardrail-gap-requires-call-site-trace.feature`
