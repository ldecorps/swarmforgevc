# Raw intake — Add not-done ticket burndown chart to the morning briefing email

Status: **new intake, not minted.** Capture only (human via Cursor
2026-08-15 ~08:28 CEST). Keep the uncommitted master-worktree draft;
do **not** discard it. Specifier: mint the ticket and decide how to land
it (pipeline vs certified hotfix, and how to reconcile the prior ban).

## Why this is in front of you

MASTER CHECKOUT DRIFT (BL-839) flagged uncommitted edits to
`handoffd.bb` / `briefing_email_lib.bb`. Same stranded WIP today's
briefing already called out (Flagged #1). Coordinator asked the human
(land-as-hotfix vs hold); human answered: **want the burndown in the
daily briefing**, and **specifier decides** ticket shape / landing path.

Prior ruling `d6db1ef56` (2026-07-26, BL-659) banned burndown as
"permanently out of scope" for PWA/Kanban analytics (growing scope).
Human now explicitly wants this chart on the **morning briefing email**
surface. Specifier decides whether that is an override of the ban for
briefing-only, a scoped exception, or a broader policy update — but the
product ask itself is locked.

## Goal

1. Mint a ticket (next free id — expected **BL-896**) for adding a
   not-done ticket burndown chart to the morning briefing email.
2. Disposition: **land the already-written draft** through whatever path
   you judge correct (normal coder→…→QA chain preferred; certified hotfix
   only if you explicitly choose that). Re-implement from scratch only if
   review finds the draft wrong.
3. Clear master-checkout drift once the draft is committed under that
   ticket — the dirty tree currently also blocks BL-891 master↔origin/main
   reconcile and holds BL-895 off promotion.

## Draft already in the master worktree (keep)

Uncommitted / untracked as of intake time:

| File | Change |
|------|--------|
| `extension/src/metrics/notDoneBurndown.ts` | 30-day remaining-open series + SVG + PNG render |
| `extension/src/tools/render-briefing-burndown.ts` | CLI → `[{name, base64}]`, name `not-done-burndown` |
| `extension/out/metrics/notDoneBurndown.js` (+ map) | compiled |
| `extension/out/tools/render-briefing-burndown.js` (+ map) | compiled |
| `extension/test/notDoneBurndown.test.js` | unit coverage |
| `swarmforge/scripts/handoffd.bb` | `briefing-burndown-json` + concat into `briefing-diagram-section` |
| `swarmforge/scripts/briefing_email_lib.bb` | human heading + note-line when burndown present |
| `swarmforge/scripts/test/briefing_email_test_runner.bb` | burndown-diagram-01 assertions |
| `docs/reference/Specification.MD` | already documents the feature (2026-08-15 para) |
| `docs/briefings/burndown-2026-08-*.{png,svg,json}` | hand samples / series (optional to keep) |

Daemons are already executing the working-tree `handoffd`/`briefing_email_lib`
bytes (BL-839 drift). Leaving them dirty is intentional until this ticket
owns the commit.

## Locked human decisions (carry through)

1. **Add** a not-done burndown chart to the **daily / morning briefing email**.
2. **Keep** the draft; do not `git checkout --` / discard the drifted scripts
   or the new TS/CLI/tests.
3. **Specifier decides** how to reconcile `d6db1ef56` (ban stays for PWA /
   briefing exception / policy rewrite) and whether to land via pipeline or
   certified hotfix — do **not** leave this as indefinite uncommitted drift.
4. Specifier does **not** need the human to re-confirm "do we want burndown
   on the briefing" — that question is closed.

## Out of scope for this intake

- Re-adding burndown to the PWA dashboard (still under the prior ruling
  unless specifier separately reopens that).
- Auto-repair of master-checkout drift by the BL-839 detector (report-only).
- Resolving BL-895's Specification.MD conflict beyond whatever minting /
  landing this ticket requires.

---

**Dispositioned 2026-08-15 (specifier).** Merged with hotfix-ledger entry
`14724edae7` into **BL-896** (`backlog/paused/BL-896-swarm-stamp-briefing-open-ticket-chart.yaml`).
The draft this intake asked to land was already committed as `14724edae7` before
the drain, so the ticket is a stamp-off review, not a landing. Ban reconciliation
(locked decision 3) decided and applied to BL-659.
