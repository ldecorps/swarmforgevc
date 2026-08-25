# BL-598 — cleaner pass — 20260825

- merge_and_process coder tip `c35cb07b6c` (clean cherry-pick).
- Alert telemetry append + false-positive rate aggregation; depth warning
  emit on swarm_handoff send path (non-blocking).
- Restored active ticket yaml + acceptance feature for pre-QA gate.
- Tests: `node --test extension/test/alertTelemetry.property.test.js` 4/4.
  `dels_on_origin=0` for coder parcel.

By cleaner.
