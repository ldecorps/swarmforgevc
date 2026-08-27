# BL-592 — post-recovery: wiring still reverted, not reviewable (2026-08-27)

## Branch-health precheck (passed)

Before touching BL-592 I re-verified the tree-collapse quarantine
([[swarmforge-architect-branch-tree-collapsed-quarantined]]) is actually
lifted, not just "clean by file count":

- `git ls-tree -r HEAD --name-only | wc -l` = 9825 (was 3/79 during the
  incident).
- `git merge-tree --write-tree swarmforge-hardender HEAD` then
  `git diff --diff-filter=D --name-only swarmforge-hardender <tree>` = **0**
  deletions — the real check, not tree-size parity.
- `git config --get core.bare` = `false`.

This part is genuinely healthy. The coordinator's nudge ("branch has been
clean a while now") is correct about the collapse. It is not correct that
BL-592 is now safe to review — see below.

## BL-592 itself: still half-reverted

Diffed every file `e5cf2a3af` ("BL-592: live spec tree on Mini App console
with epic tier (schema v2)") touched against current `HEAD`, content not
just presence:

**Genuinely restored (byte-identical or legitimate forward progress):**
- `extension/src/bridge/specTreeUiHtml.ts` — byte-identical to `e5cf2a3af`
  (254 lines).
- `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js` —
  byte-identical to `e5cf2a3af`.
- `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` —
  carries the coder's D1 `afterEach` fix (legit post-`e5cf2a3af` evolution,
  matches `BL-592-coder-bounce-fix-20260827.md`).
- `specs/pipeline/steps/index.js` — registers the step file (line 371).

**Still reverted to pre-BL-592 content** (confirmed line-by-line against
`e5cf2a3af`, not inferred from a grep miss):
- `extension/src/docs/docsTree.ts` — `DOCS_TREE_SCHEMA_VERSION` back to `1`;
  `NO_EPIC_KEY`, `EpicNode`, `buildEpicNodes` entirely absent. Diff against
  `e5cf2a3af`: 73 lines only-in-e5cf2a3af, 7 unrelated lines added since —
  a clean removal, not a merge artifact.
- `extension/src/bridge/bridgeServer.ts` — no `/spec-tree` or
  `/spec-tree-state` route, no `specTreeUiHtml` import. The orphan file
  above is never wired in.
- `extension/src/bridge/consoleMenuUiHtml.ts` — no "Spec tree" menu link
  (`id="spec-tree"` anchor and its href wiring both absent).
- `pwa/app.js` — `milestoneEpics`/`milestoneTicketCount`/
  `milestoneAllTickets` v1/v2-compat helpers entirely removed.
- `extension/test/docsTree.test.js`, `pwaDocsExplorer.test.js`,
  `pwaLocale.test.js` — back to pre-BL-592 fixtures (`schemaVersion: 1`).

## Directly verified consequence (not theoretical)

Ran the property test **scoped to this one file only** — never the
unscoped suite, per [[property-suite-full-run-hijacks-role-branch-refs]]:

```
cd extension && npx vitest run --config vitest.properties.config.mjs \
  test/bl592SpecTreeEpicTierInvariants.property.test.js
```

Both properties fail:
`TypeError: Cannot read properties of undefined (reading 'tickets')` /
`(reading 'flatMap')` — `milestoneNode.epics` does not exist because
`docsTree.ts`'s `buildDocsTree` never produces it on this branch.

`cd extension && npx tsc -p ./` compiles clean — the branch is internally
consistent, just missing the feature outright, not type-broken.

## Not confined to this branch

Checked `swarmforge-hardender`: `docsTree.ts` is schema v1 there too (no
`NO_EPIC_KEY`), while `specTreeUiHtml.ts` exists as the same orphan file.
`main` doesn't have `specTreeUiHtml.ts` at all (BL-592 never landed there).
Forwarding to hardener would not dodge this — the identical gap already
exists on that branch.

Grepped for an existing ticket naming this specific gap
(`specTreeUiHtml`, `milestoneEpics`, docsTree-schema-reverted) before
writing this file — none found under `backlog/active|paused|hold`. The
related incident family (branch-tree-collapse quarantine, record-bounce
destructive-revert-remedy) is referenced in this session's memory as
BL-1205/BL-1202/BL-1208, but none of those ticket files exist on this
worktree to confirm scope against, so I'm not asserting this exact gap is
either covered by them or is a new ticket — that call is the specifier's.

## Disposition

Same call as the two prior architect passes on this ticket this session
(`BL-592-architect-worktree-anomaly-20260827.md`,
`BL-592-architect-severe-content-loss-20260827.md`): **not** a coder
bounce (coder's `e5cf2a3af`/`308f21bca` commits are complete and correct,
confirmed real ancestors of `HEAD`); **not** forwarded to hardener (nothing
real to harden, and hardener has the identical gap already). Completing my
inbound coordinator note without forwarding a parcel. Flagging via `note`
(priority `00`) to specifier + coordinator with this evidence.
