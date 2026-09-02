# BL-1056 — LAND SUCCESS, 20260902

Coordinator note (priority 00, post-BL-1343 land): re-land BL-1056
(6e6e544400) + BL-1271 (0ea1c8cb3b), close. This covers BL-1056; BL-1271
follows separately.

Follows `BL-1056-a-land-escalate-20260902.md` (QA-approved `6e6e544400`,
held off `main` behind the BL-1343 attribution-walk defect, now fixed and
landed).

## Same discipline as BL-1317/BL-1340/BL-1341/BL-1343

`land_step_cli.bb`'s own replay for `BL-1056-a-... 6e6e544400` returned
`:replay` with an own-paths list containing files from BL-1340, BL-1341,
BL-1343 and other already-landed tickets — BL-1332's over-inclusion is
still open, so the tool's replay could not be trusted for the land. Hand-
built the tip-pure commit instead, from BL-1056's own pipeline commits
(coder `92750a3ac5`/`3ba21fe8de`, cleaner `85c8e8607a`, architect
`c26b2111aa`, hardener `713a32dd60`, documenter `e513e7905f`/`62a93258d9`),
each path individually diffed against `origin/main`.

The ticket YAML's own field update (`b01e686cfb`, the coordinator's
qa_e2e_procedure note move) was already an ancestor of `origin/main` from
earlier bookkeeping, so not re-carried.

One discovery during verification: `docs/reference/Specification.MD`'s
mid-document BL-627 section body edit (the "Price validity windows
(BL-1056)" paragraph) was already present on `origin/main` — a residue of
my own earlier BL-1317 land, before I'd learned to stop whole-file-checking
out shared docs from `swarmforge-QA`. Only the top changelog entry needed
adding here; correctly not duplicated.

## Verification (against the final tip-pure tree, before commit)

- Compile: clean.
- Targeted unit tests
  (`pricingTable`/`pricingWindows`/`costTelemetry`/`syntheticLlmCost`/
  `costHealthSidecar`): 140/140.
- Acceptance
  (`specs/features/BL-1056-a-price-with-an-expiry-date-is-a-query-not-a-memory.feature`):
  10/10.
- `docsStructureRealTree.test.js`: 5/5 — no orphaned doc.
- Full diff against `origin/main` verified to match the intended 19-file
  own-paths list exactly before pushing.

## Landed

- Tip-pure commit `407525ee7d` pushed to `origin/main`
  (`73c8f71f48..407525ee7d`), after a bounded rematch: `origin/main` had
  advanced by 5 unrelated commits (BL-1306/BL-1341 bookkeeping) between
  building the commit and pushing; diffed clean of any BL-1056 file
  overlap, cherry-picked (`-x`) onto the new tip, content verified
  byte-identical, pushed.
- `swarmforge-QA` merged up to `407525ee7d` at `782ebbd916`. No conflicts.
- `abandoned_commits: [6e6e544400]` recorded on the ticket YAML — the
  originally QA-approved commit is superseded by this tip-pure replay.

By QA.
