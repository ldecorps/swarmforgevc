# BL-1108 — hardener pass (QA bounce re-fix)

Merged architect tip `41a6f66f69` (QA bounce re-fix: Claude RC-off
HEALTHY short-circuit restored; Cursor/non-Claude absent-flag stays OFF).

## Surface

Shell + Babashka (+ acceptance/property). No TypeScript product surface —
Stryker / CRAP / DRY **not wired** for this slice. Recorded as degraded
fallback (ticket `qa_e2e_procedure` / engineering.prompt Startup Tools).

## Mutation cooldown gate

| file | DECISION |
|------|----------|
| `swarm_ensure.bb` | **skip-cooldown** (file_age_days ≈ 0.45 < 3) |

Host load ~6 on 20 cores (under 2× cores). Language / hand-authored
mutation on `swarm_ensure.bb` deferred per gate; targeted-test hardening
this pass.

## Targeted hardening (this pass)

Added **RC-6c**: `local-model` seat with no `--remote-control` must report
`rc:coder: OFF (...Cursor Remote...)` without probing. Locks the absent-flag
branch as "not claude" (second non-Claude token), not "is cursor" —
RC-6 (Claude HEALTHY) + RC-6b (Cursor OFF) alone would not kill a
cursor-hardcoded mutant.

## BL-113 Gherkin mutation (soft)

Soft re-run: `total=0 skipped_scenarios=1 skipped_mutations=8`,
`outcome: pass` (BL-460 stamp still valid). Prior manifest: 8/8 killed,
0 survived. Durable verdict is the feature-file manifest, not stdout zeros.

## Suites (green)

- `env -u SWARMFORGE_CONFIG bash swarmforge/scripts/test/test_swarm_ensure.sh` — ALL PASS (incl. RC-6, RC-6b, RC-6c)
- Acceptance BL-1108 — 4/4 PASS (fresh `npm run compile` first)
- Property `bl1108CursorSeatReadiness.property.test.js` — 2/2 PASS

## Notes

- No hand-authored mutation on cooldown-skipped `swarm_ensure.bb` this pass.
- Equivalent/host-masked: none.

By hardender.
