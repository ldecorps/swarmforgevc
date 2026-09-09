# Babysitter Article 4.2 — BL-1386+BL-1387 QA hand-land, another instance of the standing false-positive class

Date: 2026-09-04T13:44Z (health sweep). One `BABYSITTER_ESCALATION`:

- `04543cb639dbb474413b2aa35720996a17746eb4` "BL-1386 + BL-1387: tip-pure
  hand-built replay onto origin/main (BL-1241 remedy, BL-1354 residual per
  specifier adjudication)" (author `t`, 2026-09-04T14:44:51+01:00, trailer
  `By QA.`), touching `specs/pipeline/steps/bl1386ReconcileOwnsItsMergeSteps.js`,
  `specs/pipeline/steps/bl1387OrphanedMergeSurfacedSteps.js`,
  `specs/pipeline/steps/lib/bl1386ReconcileOwnsItsMergeCli.sh`,
  `specs/pipeline/steps/lib/bl1387OrphanedMergeCli.sh` (+ 39 more files).

**FALSE POSITIVE.** Same mechanism as
`babysitter-article42-qa-handland-on-main-false-positive-20260904.md`
(the fifth sub-cause): QA hand-built this commit directly in the shared
master checkout per the specifier's own routing
(`backlog/evidence/BL-1386-land-escalate-adjudication-20260904.md`), so it
never passed through `swarmforge-QA` and is unapproved *by construction*
under the ancestry-only predicate.

## Verified, not assumed

- `is_qa_ancestor.sh 04543cb639...` → exit 1 (clean "no": not an ancestor
  of `swarmforge-QA`, not a corrupt-store failure).
- `git branch -a --contains 04543cb639...` → `origin/main` only (local
  `main` hadn't fast-forwarded yet at investigation time — separately
  blocked by the still-active BL-1386 stopgap on
  `master_main_reconcile_enabled`, unrelated to this finding).
- Content matches the adjudication's prescribed recipe exactly:
  - `git diff 04543cb639^ 04543cb639 -- extension/src/concierge/pendingApprovalReply.ts extension/src/bridge/bridgeServer.ts specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js`
    → empty. BL-1367's exclusive paths were correctly excluded (an earlier
    existence-only check on these paths was a red herring — the files
    predate BL-1367 and already existed on `origin/main`; the adjudication
    was about excluding BL-1367's *changes*, not the files' existence).
  - Both BL-1386 and BL-1387 step-handler files present on `origin/main`.
  - Full diff stat (43 files, +3955/-43) is scoped to
    `swarmforge/scripts/handoffd.bb`,
    `swarmforge/scripts/master_main_reconcile_lib.bb`,
    `swarmforge/scripts/post_hotfix_merge_origin*.bb`, `swarmforge/scripts/swarm_heal.bb`
    (BL-1386/1387's own domain: reconcile-sweep merge ownership), the two
    tickets' own evidence/test/property files, and the untagged briefing
    sidecar (rides by design, BL-1315). No BL-1367 content, no unrelated
    ticket's content.
  - `swarmforge/swarmforge.conf` is NOT touched — this land does not
    silently flip the BL-1386 reconcile stopgap back on; that remains a
    separate, deliberate step.

## Action

None. No revert (nothing to revert — the land is correct and authorized).
No new ticket (same standing class as the prior instance; the mechanism
is already tracked). Reported to the human for awareness.

By coordinator.
