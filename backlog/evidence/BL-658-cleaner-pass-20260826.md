# BL-658 — cleaner pass — 20260826

- merge_and_process coder tip `721b25a072` (clean merge).
- DRY: `okFixture` helper in `nightClosingCeremony.test.js`; schedule-override
  lookup table in APS steps.
- Fix: restore `node:test` import in unit/gate suites (`node --test` was
  ReferenceError: test is not defined).
- Left pure core as-is under BL-1124 (`extension/src`, `*.property.test.js`).
  Note for architect: `shouldConsultFixedMorningTrigger` ≈
  `fixedMorningTriggerFires` (same predicate).
- Wiring script `test_handoffd_closing_ceremony_gate_wiring.sh` exercised.

By cleaner.
