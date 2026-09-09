# Babysitter Article 4.2 — a FOURTH sub-cause: the expedite lane lands with no QA parcel, so every expedite commit flags

Date: 2026-09-04T00:18Z (Operator, event-driven run). Babysitter escalated two
`pipeline-code-on-main` findings:

- `5a54d66774` "BL-1371: a step handler registers by discovery, not by a shared
  array" (single-parent, parent `761bd72397`, trailer `By coder.`,
  2026-09-03T15:57:33Z)
- `e1e07c364e` "BL-1371: record the hardener pass — closed 2 real mutation gaps,
  killed both" (single-parent, parent `724ef8f714`, trailer `By hardener.`,
  2026-09-03T16:13:35Z)

Both are **FALSE POSITIVES**. No pipeline code bypassed a gate it was subject to.

Distinct from the three sub-causes already on file:
- `babysitter-article42-expedite-rematch-false-positive-20260903.md` (BL-1025's
  exemption keyed on an expedite TIP sha the BL-1144 rematch destroys)
- `babysitter-article42-union-merge-false-positive-20260903.md` (BL-962's
  byte-identity exemption cannot clear a union merge)
- `coordinator-babysitter-article42-false-positive-20260902.md`
  (`land_step_cli.bb` replay commits carry no `By QA.` trailer)

## Verification (provenance, not subjects)

- `git branch --contains` puts both commits on `expedite/BL-1371` and on `main`
  only via the expedite land merge `ed9efe8e18` ("Merge expedite/BL-1371: a step
  handler registers by discovery, not by a shared array"). Neither reached main
  by any other route.
- BL-1371 ran the full expedite role sequence and each pass wrote its evidence:
  `BL-1371-{architect,architect-rerun,coder,cleaner,documenter,hardener,hardener-rerun}-pass-20260903.md`.
- There is no `BL-1371-qa-pass` file because the **expedite lane does not route a
  QA parcel** — that is the lane's design, and the lane is in force by standing
  human directive. The flagged commits therefore carry `By coder.` / `By hardener.`
  trailers, which is correct for their authors.
- `BL-1371` is `status: done` in `backlog/done/`, landed and closed.

## Why this recurs (the actual defect, not this ticket)

The Article 4.2 check recognises only a QA-trailered or QA-exempted path onto
main. It has no notion of the expedite lane, so **every** role-authored commit of
**every** expedite run will escalate — two per run here, and the lane is standing.
This is a fourth exemption gap in the same check, not a fourth accident.

Nearest existing ticket is `backlog/paused/BL-1359-a-merge-is-charged-only-with-what-it-introduced.yaml`,
which covers the merge-charging sub-cause only and does NOT cover this one.
Minting/scoping is the specifier's call; recorded here so the adjudication is not
re-derived a seventh time.

## Also cleared in this run (not a separate incident)

Six `BABYSITTER_ESCALATION` "pane alive but NO claude process under it" events
(cleaner, architect, hardender, documenter, QA, coordinator) were the known
half-launch false positive: the swarm had been relaunched ~25s earlier, and `ps`
showed all eight roles with live `claude` processes (etime 00:13–00:25) against
their own `.swarmforge/launch/<role>.claude-settings.json`. All 8 panes
`dead=0`; `handoffd.heartbeat` fresh. No respawn taken, none warranted.
