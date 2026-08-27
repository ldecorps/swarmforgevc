# BL-755 — cleaner pass — 20260826

- merge_and_process coder tip `63607a6c57` (clean merge).
- DRY: `setThreeArmParser` + `assertPerArmGuidance` in
  `bl755PilotMultiBranchParserNeedsPerArmTestsSteps.js` (shared fixture /
  prompt assertion for hardener + /pilot).
- Kept `node:test` in unit suite (`node --test` 6/6). Property encoding left
  as coder shipped (BL-1124: no restage of `*.property.test.js` / `extension/src`).
- Applied ticket lens: multi-arm coverage gate treats missing arms as
  untested-behavior, not praise for the one covered hazard.

By cleaner.
