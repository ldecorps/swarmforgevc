# Master working-tree diff review — 2026-07-31

Outcome of `backlog/INTAKE-untracked-master-changes-need-review.md` (human
directive: "it is probably changes not done by the swarm and I want the swarm
to review it"). The raw intake is drained and removed from the backlog root.

Reviewed: 83 status entries on the shared master checkout — 65 modified, 18
untracked. The coordinator's rough grouping was broadly right; two corrections
are marked below.

## Provenance

Out-of-band work by a Cursor session editing this checkout directly, outside
`swarm_handoff.sh` and outside any worktree — the known third-writer-on-master
pattern. The untracked `.cursor/rules/bugfix-process-tdd.mdc` and the presence
of matching vitest files for each new module say the session followed a TDD
process; this is not slop, it is unreviewed work that skipped the pipeline.

## Safety

Before anything else, the whole working tree (including untracked files) was
snapshotted to a local ref, without touching the tree or the index:

    refs/salvage/master-diff-20260731   e3ff0b96cd

Recover any path with
`git checkout refs/salvage/master-diff-20260731 -- <path>`. Nothing was
reverted, stashed or discarded. The ref is local and unpushed.

## Disposition

### Landed by the specifier this pass (non-functional, no ticket needed)

| Group | Files | Commit |
|---|---|---|
| Human-directed priority/notes edits on paused tickets | 20 YAML | `6e10f82c2` |
| New specs BL-722, BL-758 + BL-722 feature file | 3 | `6e10f82c2` |
| Raw human root intakes | 6 | `6e10f82c2`, later commits |
| BL-716 in-flight acceptance amendment (dns-05) | 1 | `862a05f79d` |
| Interface-vs-incarnation directive in the Specification | 1 | `122898a73` |

BL-722 matters most here: it was approved and queue-jumped to priority 0 while
its spec and feature file sat untracked, so no worktree role could ever see it
(BL-314). It is now visible.

### Functional code — retro-ticketed, adopt not revert

Adopt posture follows the fork the human already approved on BL-763: the coder
starts from the working tree, the ticket is the retroactive ticket, the pipeline
reviews it as ordinary parcel content. Nothing is committed to `main` outside a
parcel.

| Ticket | Group | State |
|---|---|---|
| **BL-764** (defect, high) | Shared-token dual poller: front desk dropped Host/Bubble updates. Inbound-queue fan-out, `--help` poller thief, bridge liveness cue. `cursorBridgeInboundQueue.ts`, `telegramCursorBridgeLiveness.ts`, `telegramFrontDeskBotCore.ts`, `telegramCursorBridge{Core,Live,Redeploy}.ts`, `telegram-cursor-bridge.ts`, `telegram-front-desk-bot.ts`, `telegramTopicDecisions.ts` + tests | new, `human_approval: pending` |
| **BL-765** (feature) | Bubble remote capability config + remote hold-music catalog + music/reply volume split. `letsTalkBubbleConfig.ts`, `letsTalkChiptunes.ts/.json`, `tsconfig.json` `resolveJsonModule`, all `android/app/**`, how-tos BL-705/BL-707 | new, `human_approval: pending` |
| **BL-766** (defect, high) | Mini App Let's Talk half-retired. `consoleMenuUiHtml.ts`, `bl696LetsTalkSteps.js`, how-to BL-696, `extension/package.json` CRAP scope, `extension/scripts/letsTalkCursorBridgeCoverage.js` | new, `human_approval: pending` |
| **BL-763** (defect, existing) | Cursor Remote always-on + bounce meta. Amended this pass to also claim `swarm_ensure.bb` and `operator_runtime.bb`, which no other ticket owned | amended, already approved |
| **BL-722** (feature, existing) | `/pilot safe`. `pilotSafeDefects.ts` + wiring in `telegramCursorBridgePilot.ts` | already approved, priority 0 |
| **BL-716** (defect, existing, ACTIVE) | Tunnel hostname discovery. Its feature file was amended out-of-band | coder notified |

Correction to the coordinator's grouping: the big chunk is **not** one coherent
feature. It is five, and two of them were already ticketed before this review —
folding them together would have duplicated BL-763 and BL-722.

## Flagged — decisions the swarm should not make alone

1. **BL-766 is a genuine defect, and no gate caught it.**
   `specs/pipeline/steps/bl696LetsTalkSteps.js` was rewritten to `JSON.parse`
   the body of `GET /lets-talk` and assert `health.talkClient == "bubble"`.
   `bridgeServer.ts:1567` still serves the Mini App HTML there, and the string
   `talkClient` is produced nowhere under `extension/src`. Those scenarios
   cannot pass as written. Separately, `src/bridge/letsTalkUiHtml.ts` — 61k,
   still routed, still depended on by `specs/features/BL-697-*.feature` — was
   dropped from `crap:lets-talk-cursor-bridge`, so a live file left the CRAP
   gate's scope. Static evidence; confirm by running the BL-696 acceptance.
   The repair fork (finish the retirement vs revert the step rewrite) is in the
   ticket's `approval_context`.

2. **`.cursor/rules/bugfix-process-tdd.mdc` is undecided.** 45 lines of Cursor
   IDE process config at the repo root, untracked. Either track it (it governs
   the third writer, so making it explicit has value) or gitignore `.cursor/`.
   Left in place; not the specifier's call.

3. **`docs/briefings/`** — `.sent.json` plus two generated briefings. Output
   artifacts belonging to whoever runs briefings, not to a ticket. Left for the
   coordinator to commit.

4. **Bookkeeping stays blocked until the adopt tickets land.** The functional
   code cannot be committed to `main` outside a parcel without bypassing the
   gates, which is exactly what BL-763's approved framing rejects. So
   `build_freshness_cli.bb sync` will keep refusing on the dirty tree, and the
   live bridge keeps running from `extension/out/` compiled from these
   uncommitted sources — reverting them would regress the phone on the next
   compile. Pull BL-764 and BL-766 early for that reason.

5. **A specifier clarifying question has been pending since 2026-07-30** and
   holds the one-question-per-role slot, so the adopt-vs-rebuild fork could not
   be put to the human directly. It was resolved by precedent (BL-763, approved)
   instead. The pending question concerns disposing of three root intakes,
   including the Live Screen migration that BL-766 deliberately does not widen
   into. Answering it unblocks both.
