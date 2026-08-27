# BL-1200 — hardener pass — 20260827

## Inbound — commit substitution (2nd occurrence today, same class)

Received `git_handoff` from architect naming commit `b7f48b0edf`. Corrupted:
80-file tree (vs HEAD's ~9770), first parent `d6c467a8a` collapses to a
79-file tree. Traced the chain: `c4e382c71` (coordinator's merge of the real
fix, second-parent lineage) has a sane 9778-file tree and merges cleanly
against my HEAD with zero conflicts — the corruption entered specifically
at `d6c467a8a`'s first parent (`1cc8402bac`), the same BL-1124-class ambient
GIT_DIR/GIT_WORK_TREE leak as the BL-751 incident earlier today.

Merged `c4e382c71` instead of `b7f48b0edf` (commit `05249d9e3`). The
architect's own real content addition on the corrupted tip —
`backlog/evidence/architect-vitest-node-test-no-suite-found-20260827.md`
(48 lines, documents the same node:test/Vitest gap noted below) — was
recovered verbatim onto the clean merge rather than dropped (commit
`c9e2acaea`).

## What BL-1200 actually delivers

`swarmforge/scripts/test/lib/git_env_guard.sh`: unsets `GIT_DIR`/
`GIT_WORK_TREE` unconditionally, safe to source twice, safe under `set -u`.
Sourced from `expedite_fixture.sh` (the fixture that actually fired) and
`run_bb_suite.sh` (the standing suite entry point). Feature file has one
plain Scenario + one Scenario Outline (2 examples: `HEAD`, `current branch`).

## Gates

| Gate | Result |
|---|---|
| Compile | PASS |
| Shell unit `test_git_env_guard_lib.sh` | 5/5 PASS |
| Acceptance (`run_acceptance.sh`) | 3/3 PASS |
| BL-113 Gherkin mutation (soft) | **2/2 KILLED** — both via `readRef`'s keyed lookup (`unrecognized <ref> example value`), mutation-tight per the keyed-vs-shape discipline |
| Property test `bl1200FixtureGitWritesStayInOwnRepo.property.test.js` | 4/4 PASS via `node --test`; **cannot run via `npm run test:properties`** — see below |
| CRAP / DRY | N/A — bash has no wired CRAP/mutation/DRY tool (engineering.prompt); gated by its own unit suite only. New JS step-handler file: jscpd scoped to `**/*.ts` only, N/A |
| Fixture cleanup | Verified safe: `mkSocketFixtureRoot`'s BL-948 process-exit backstop reaps the decoy root even on the `readRef` validating-throw path (my own standing rule's exact hazard class — already closed by this shared helper, no action needed) |

## Property-suite / Vitest gap — 3rd independent confirmation, still unticketed

Reproduced directly (`npx vitest run --config vitest.properties.config.mjs
test/bl1200FixtureGitWritesStayInOwnRepo.property.test.js`): `Error: No test
suite found in file ...` despite all 4 cells genuinely passing (TAP output
shows `ok 1..4`). This is the SAME node:test/Vitest incompatibility I
recorded in `backlog/evidence/BL-751-hardener-pass-20260827.md` (for plain
`*.test.js`) and the architect independently found across 14+
`*.property.test.js` files (recovered evidence file above). Grepped
`backlog/{paused,active,hold}` for "No test suite found" — still no ticket.
Sent a `note` (priority `00`) to specifier+coordinator: this is now a THIRD
independent discovery of the same live gap with no ticket minted.

Not a BL-1200 defect: the coder used the file's own pre-existing
`require('node:test')` convention; root cause predates BL-1200 (confirmed
on files untouched by today's incidents). BL-1200's declared invariant is
verified correctly, just not through the standard property-suite command.

## Forward

`git_handoff` to `documenter`, priority `00`, task `BL-1200`.

By hardender.
