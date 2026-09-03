# BL-1333 — documenter pass, 2026-09-03

Merged hardener commit `bce35dd613` — clean merge, no conflict (the
`specs/pipeline/steps/index.js` require line landed without collision this
time).

## Nature of this ticket

BL-848 review-only stamp-off of already-landed hotfixes `f57795b6d2`
(daemon wiring) and `d5739d84cc` (pure-decision first half). Confirmed
`backlog/hotfix-ledger.yaml` is untouched — both rows still
`state: stamp-open`, `human_decision`/`decided_at` null — and the parcel's
diff touches only test/step-handler/fixture files, no production code.
Constraints forbid reimplementing/rewriting/redescribing the hotfix's own
decision; documenting what is ALREADY LIVE on `main` accurately is in
scope (Article 1.7) and is what this pass does.

## Doc review

- Followed the established stamp-off pattern (BL-1113/1117/1116/1324/1254/
  1283/1321): added a BL-1333 entry to
  `docs/how-to/BL-848-certify-an-operator-hotfix.md`'s "Related" list
  (commit `2eb650826b`), naming both reviewed commits, what the hotfix
  does, and that the review found no defect in the hotfix itself (the one
  real gap the pipeline caught — a socket-path-length violation in the
  review harness's own fixture — was already fixed by the hardener before
  reaching this pass).
- Found a genuine doc defect this pass, distinct from the "Related" bullet
  convention: `docs/how-to/BL-891-master-main-reconcile-sweep.md` is the
  PRIMARY living reference for the master-main reconcile mechanism this
  hotfix modifies, and it described the pre-hotfix behavior only — step 4
  and the "dirty overlap, not reconciled" verdict row said every
  overlapping path blocks, with no mention that a path proven
  byte-identical to `origin/main` is now dropped and the merge proceeds.
  The commits landed 2026-09-02 (per the ticket's own WHY section) and
  this is the first pipeline pass to reach that code, so the doc has been
  stale since landing with no earlier documenter pass to have caught it.
  Updated (commit `f27eb2566c`): step 4's new redundancy-proof paragraph,
  the "dirty overlap, not reconciled" verdict row, and the "What it does
  not do" byte-identical-checkout invariant (narrow exception noted, still
  content-preserving).
- Checked `docs/reference/Specification.MD`: not touched, matching the
  majority precedent for review-only stamp-offs (BL-1321/1283/1324/1113/
  1117) — the substantive documentation lives in the BL-891 how-to update
  above, which is where an operator or agent actually reading this
  mechanism looks.
- No diagram registered under `docs/diagrams/` depicts the reconcile
  daemon's internal overlap-proof logic; none of the four registered
  diagrams' change-triggers fired.
- No RETIRED/deprecated behaviour involved — Article 3.6 not implicated.

## Verdict

No documenter-domain defect found in this ticket's own diff; one
pre-existing stale-doc defect found and fixed (the BL-891 how-to, above).
Forwarding to QA.
