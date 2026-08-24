# BL-1112 — architect pass (FF-only rematch) — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner rematch tip `f9788edff3` (on FF-only coder tip `7a70c99207` /
`4524df1ee4`). Per coder instruction
`BL-1112-coder-ff-only-instruction-20260824.md`, architect **recreated**
`swarmforge-architect` on this tip (`git checkout -B … f9788edff3`) — did
**not** merge into hitchhiked local ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN (18 paths, BL-1112 surface + evidence only).

## Architecture

Prior passes still hold:

- `listProcessTree`: `ps … args=` + basename (Node 24 `comm=` hole).
- Stryker sibling links: `lstat` + `unlink` before recreate.
- Stamp-off locks named `&nbsp;` as `pipelineBoard` emits on this tip /
  `origin/main`.

## Gates

| Gate | Result |
|---|---|
| Compile | OK |
| Unit (activation + sampleResources + stryker) | **52/52** |
| Acceptance (BL-1112) | **6/6** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

Hardender (and every later role): **recreate** the role branch on this tip;
do **not** `git merge` into hitchhiked ancestry. Re-check the hitchhike gate
before handing off.

By architect.
