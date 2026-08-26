# BL-758 hardener pass — per-hat role prompt evidence land gate — 20260826

**Architect tip:** `86f2ac1101`
**Task:** `BL-758-pilot-inject-role-prompts-per-hat`

## Gates

| Gate | Result |
|------|--------|
| unit `perHatRolePromptEvidenceCheck.test.js` | 7/7 (fail-open, empty no-op, hash/path polarity) |
| unit `telegramCursorBridgePilot.test.js` | 20/20 (includes BL-758 compose tests) |
| property (vitest.properties) | 4/4 |
| APS BL-758 | 6/6 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl758_per_hat_role_prompt_mutation_sweep.sh` | killed=6 survived=0 skipped=0 |
| BL-149 cooldown | `run` on perHatRolePromptEvidenceCheck.ts |

## Hardening delta

- Fail-open unit (`checked: false` when verdicts undefined).
- Empty-verdict no-op unit.
- Reject whitespace-only path, short hash, and non-hex 64-char hash.
- Hand-authored surgical sweep locking fail-open, miss polarity, path∧hash,
  sha256 length, and empty-path gate.

Tip purity: no `mutations/` / `base/` caches staged.

By hardender.
