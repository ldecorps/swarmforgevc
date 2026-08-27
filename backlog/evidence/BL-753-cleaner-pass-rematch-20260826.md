# BL-753 — cleaner pass (architect rematch) — 20260826

- merge_and_process coder tip `98db2c5453` (architect bounce D1: property
  encoding for unreachable-handler land refuse).
- Review: `unreachableStepHandlerCheck.property.test.js` encodes invariant 1
  (miss / match / no-op / inert land refuse) + non-vacuity; 6/6 green via
  `vitest.properties.config.mjs`.
- No further DRY committed: `mkGateDeps` mirrors unit `mkDeps` (same pattern
  as BL-747 property/unit split). Editing `*.property.test.js` would trip
  BL-1124 property-suite-guard on this host; encoding already on tip from
  coder merge.
- Applied BL-753 rule: bounce was a real untested-behavior encoding gap, not
  a cosmetic nit — rematch closes it.

By cleaner.
