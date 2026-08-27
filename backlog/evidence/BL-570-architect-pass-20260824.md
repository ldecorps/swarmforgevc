# BL-570 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner tip `992206d5f9` (cherry-pick of hitchhike-free coder surface onto
`origin/main`). Architect **recreated** `swarmforge-architect` on this tip
— did **not** merge into prior local ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN (12 paths).

## Architecture

Mirrors BL-105 / commit-size guard pattern:

- Standalone `check_property_suite_drift.sh`; pre-commit invokes it
  unconditionally (sibling fixture installs updated so other guard tests
  do not fail on a missing script).
- Trigger scoped to `extension/src/*` and `*.property.test.js` (nested
  `src/` paths match; docs/backlog skip).
- Fail-open when toolchain unavailable (`node_modules` / exit 127).
- Explicit `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` override with warn.
- Suite command injectable via argv (no `*_FORCE_RESULT` bypass).
- Steps registered in `specs/pipeline/steps/index.js`.

No declared `invariants:` on the ticket. Shell unit + Gherkin cover the
acceptance table; no extra property test required on this bash surface.

Coder land note (live `test:properties` mutating worktree refs) is an
operational hazard of the real suite the ticket asked to run — recovery
override is the designed escape; not a send-back on this parcel.

## Gates

| Gate | Result |
|---|---|
| Unit (`test_property_suite_drift_guard.sh`) | **ALL PASS** (7) |
| Acceptance (BL-570) | **7/7** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-570-property-suite-drift-guard`.

Hardender (and later roles): recreate the role branch on this tip; do not
merge into hitchhiked ancestry. Re-check the hitchhike gate before handoff.

By architect.
