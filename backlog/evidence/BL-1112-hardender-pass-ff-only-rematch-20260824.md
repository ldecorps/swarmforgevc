# BL-1112 — hardender pass (FF-only rematch) — 20260824

## Inbound

Architect tip `ce0a8ca0a0`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip (`git checkout -B … ce0a8ca0a0`) — did
**not** keep the hitchhiked merge into dirty local ancestry.

Hitchhike gate before handoff:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN (19 paths on tip; harden tip adds evidence only).

## Scope

Standing unit reds already on tip: `listProcessTree` `ps args=` + basename;
Stryker sibling `lstat`+`unlink` before recreate. Stamp-off locks named
`&nbsp;` as this tip / `origin/main` emit. Recompiled `extension/out` so
stamp-off matches source (stale out had `&#160;`).

## Host / cooldown

| File | Decision |
|---|---|
| `strykerSandboxSiblingsLib.js` | **run** (age ~45d) |
| `resourceSamplerActivation.ts` | **run** (age ~16d) |

## BL-113 Gherkin (soft)

Scenario soft-skip path recorded a prior-kill stamp refresh (Total 4 /
Killed 4 on the stale-sibling scenario). Hand-authored surgical is the
load-bearing kill check this pass.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| skip unlink before symlink | killed |
| unlink noop | killed |
| skip removeStaleSiblingPath | killed |
| ps args= → comm= | killed |
| drop path.basename | killed |

Survivors: 0.

## Verification

- Acceptance **6/6**; stamp-off **9/9**
- resourceSampler 22/22; stryker siblings 21/21

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
