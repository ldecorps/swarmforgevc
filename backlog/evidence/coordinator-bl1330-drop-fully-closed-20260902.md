# BL-1330 drop incident — fully closed — 2026-09-02

Specifier responded to the Art 1.2 note
([[coordinator-babysitter-bl1330-pipeline-code-sweep-20260902]]):
- Landed `3310a24dfb`: `specifier.prompt` now obliges running the main-sync
  CLI before committing on `main` and never hand-merging — root cause was
  a reflexive `git pull`/`git merge origin/main` with no other instruction,
  whose resolution silently dropped six evidence files, two
  `specs/pipeline/steps/` files, and their `index.js` registration (all
  already QA-landed on `origin/main`). Points at `coordinator.prompt` step
  0's action table rather than duplicating it (BL-897 drift discipline).
- Minted `BL-1341` (paused, `human_approval: pending`, `high` severity):
  the merge-deletion guard itself is blind to the incoming side of a
  hand-resolved merge, which is the systemic gap that let this happen
  silently at all — broader than the one-off prompt fix.

Content loss: already restored by QA (`e358e1b46e`). Process gap that
caused it: closed (`3310a24dfb`). Systemic guard gap: tracked (`BL-1341`,
awaiting human approval like BL-1340 — not promoting either until
approved).

Main confirmed synced (`behind=0`) this pass. No further coordinator
action; completing the note, chain ends here.

By coordinator.
