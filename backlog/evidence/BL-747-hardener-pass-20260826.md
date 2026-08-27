# BL-747 hardener pass — shell entry-point drive pilot gate — 20260826

**Architect tip:** `34732038c9`
**Task:** `BL-747-bl637-pilot-missed-parallel-reimplementation`

## Gates

| Gate | Result |
|------|--------|
| unit `shellEntryPointDriveCheck.test.js` | 9/9 (added `node:test` import + fail-open assertion) |
| property | 3/3 |
| APS BL-747 | 6/6 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl747_shell_entry_point_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| BL-149 cooldown | `run` on shellEntryPointDriveCheck.ts |

## Hardening delta

- Import `node:test` in unit file.
- Unit covering `assessShellEntryPointDrive` fail-open (`checked: false` when
  ticketYaml/shellTests undefined) — closed surgical survivor that collapsed
  unreadable inputs into a vacuous checked:true empty scan.
- Hand-authored surgical sweep locking invoke-vs-source, dual-condition no-op,
  and fail-open.

Tip purity: no `mutations/` caches staged.

By hardender.
