# BL-749 — cleaner pass — 20260826

- merge_and_process coder tip `5bd68a45dc` (clean merge).
- DRY/clarity: `assertNextUnreadRolePrompt` replaces empty-if / typo'd flag
  state machine in `bl749PilotGuardrailGapRequiresCallSiteTraceSteps.js`.
- Fix: `telegramCursorBridgePilot.test.js` uses Vitest global `test`.
- Applied BL-749 call-site rule to this review: role-prompt + pilot brief
  wording matches ticket guardrail; no call-site defect in compose path.
- Verification: `telegramCursorBridgePilot.test.js` green including BL-749 case.

By cleaner.
