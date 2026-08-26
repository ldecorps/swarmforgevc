# BL-753 — cleaner pass — 20260826

- merge_and_process coder tip `81af7a1235` (YAML add/add conflict: took
  coder ticket body; kept active path).
- DRY/clarity: `assertNextUnreadRolePrompt` for cleaner→hardener→architect
  prompt checks; drop IIFE double-require of gate/pilot modules.
- Fix: `unreachableStepHandlerCheck.test.js` uses Vitest global `test`.
- Applied BL-753 rule to this review: land-gate + role/pilot prompt wording
  treat unreachable handlers as untested-behavior flags (not cosmetic nits);
  no call-site gap found in compose / checkUnreachableHandlers wiring.
- Src DRY left for architect/hardener notes: `commitClaimGitReader` gate
  wiring mirrors BL-747 (intentional). Not restaged under BL-1124.

By cleaner.
