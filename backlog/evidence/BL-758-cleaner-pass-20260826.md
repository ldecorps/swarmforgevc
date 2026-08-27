# BL-758 — cleaner pass — 20260826

- merge_and_process coder tip `6eb2c69acc` (clean merge).
- DRY: `composeStageForRole` / `readLiveRolePrompt` / `incompleteVerdict` in
  `bl758PilotInjectRolePromptsPerHatSteps.js` (shared stage compose + verdict
  fixtures for omit / bounce-back scenarios).
- Kept `node:test` in unit suites (`node --test` green). No restage of
  `extension/src` / `*.property.test.js` (BL-1124).
- Applied ticket lens: per-hat reinject is real prompt injection evidence,
  not a mega-brief reminder nit.

By cleaner.
