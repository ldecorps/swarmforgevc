# BL-1150 — cleaner pass — 20260826

- merge_and_process coder tip `424e94ee20` (clean merge).
- Fix: `outage-driven-seat-failover-sweep!` docstring placed before arg vector
  (was a discarded string body form).
- Fix: unit test uses Vitest global `test` (drop `node:test` import).
- Property file still imports `node:test` — BL-1124 blocks committing
  `*.property.test.js` / `extension/src/*` on this host.
- Verification: `test_outage_failover_cli_load_file_safe.bb` PASS; unit 3/3.

By cleaner.
