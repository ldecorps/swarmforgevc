# BL-588 hardener pass (rematch 8) — scrub-deleted-siblings — 20260826

**Architect tip:** `6d7bd3fd58`
**Task:** `BL-588-isolate-batch-recovery-trees-scrub-deleted-siblings`
**Rematch context:** cleaner re-cut BL-588-only post-BL-1159 QA land (`571de455b` base).

## Gates

| Gate | Result |
|------|--------|
| `batchRecovery.test.js` | 13/13 |
| `batchRecoveryCli.test.js` | 3/3 |
| `batchRecovery.property.test.js` | 3/3 |
| APS BL-588 | 7/7 |
| Gherkin mutation (hard) | stamp valid — **3/3 killed** |
| Stryker | N/A — pure TS recovery slice |

## Hardening delta

- **Merge conflicts:** `Specification.MD` — BL-1159 prepended, BL-588/660/653 retained once; `BL-1159` yaml trivial blank-line conflict resolved.
- **Merge hygiene:** `defineScoped` order intact; BL-653/660 allowlists present; single bl728 registration; bl588 at line 333, bl1160 retained.
- **No code changes required** — architect slice verified green end-to-end.

By hardender.
