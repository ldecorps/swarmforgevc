# BL-1150 hardener pass — outage_failover_cli load-file safe — 20260826

**Architect tip:** `80ed439d5a`
**Task:** `BL-1150-outage-failover-cli-load-file-safe`

## Gates

| Gate | Result |
|------|--------|
| unit `bl1150OutageFailoverCliLoadFileSafe.test.js` | 3/3 (added missing `node:test` import) |
| property | 1/1 |
| `test_outage_failover_cli_load_file_safe.bb` | PASS |
| APS BL-1150 | 2/2 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl1150_outage_failover_cli_mutation_sweep.sh` | killed=3 survived=0 skipped=0 |
| BL-149 cooldown | `skip-cooldown` on outage_failover_cli.bb / handoffd.bb |

## Hardening delta

- Import `node:test` in unit file so `node --test` discovers suites.
- Hand-authored surgical sweep locking the babashka.file entrypoint guard
  (bare `-main`, flipped `=`, typo'd property name).

Tip purity: no `mutations/` / `base/` caches staged.

By hardender.
