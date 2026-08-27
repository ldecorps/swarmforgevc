# BL-570 — hardender pass — 20260824

## Inbound

Architect tip `6abd0b32a8`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip — did not merge into hitchhiked ancestry.

Hitchhike gate before handoff:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Scope

Property-suite drift guard: standalone script + pre-commit wire; scoped
trigger; fail-open on toolchain; explicit override. Hardened the wiring
assert so naming the script only in a comment cannot survive.

## Host / cooldown

| File | Decision |
|---|---|
| `check_property_suite_drift.sh` | **run** |
| `pre-commit` | **run** |

Bash surface — no Stryker. Soft Gherkin **8/8** killed on the Examples
scenario; surgical below is load-bearing for production script/hook.

## Harden locks

- Unit 07 + acceptance install step require a **non-comment** invocation of
  `check_property_suite_drift.sh` in `pre-commit`.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| never-trigger paths | killed |
| drop `*.property.test.js` glob | killed |
| fail-closed on exit 127 | killed |
| ignore override | killed |
| never block red suite | killed |
| unwire pre-commit call (leave comment) | killed |

Survivors: 0.

## Verification

- Unit **ALL PASS** (7)
- Acceptance **7/7**
- Stamp-off (BL-1113) **9/9**

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-570-property-suite-drift-guard`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
