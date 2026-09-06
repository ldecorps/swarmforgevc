# Incident — BL-1424's land replay silently dropped its own deliverable — 2026-09-06

## Summary

`land_main_publish.sh --land` for BL-1424 (a fully QA-verified, correct
parcel — see `BL-1424-QA-20260906.md`) triggered `land_step_lib.bb`'s
`:action :replay` path (BL-1241 remedy) because of a genuine but harmless
entanglement (BL-1445's `hardender.prompt` content riding along, already
landed). The replay's own bounded walk (BL-1432's `parcel-own-base`
optimization) computed a WRONG `own-paths` set: it built and PUSHED a
commit (`002def27c6`) to `origin/main` containing only 5 documentation/
evidence files and OMITTING the entire functional deliverable — the guard
script, its CLI, the shared lib changes, `run_commit_guards.sh`'s wiring,
both test files, the property runner, and the acceptance handler. `origin/
main` briefly had a commit subject claiming "BL-1424: tip-pure replay onto
origin/main" whose tree did not contain BL-1424's own guard at all.

**This was caught and fixed before any downstream action** (no merge-up
broadcast was sent, no coordinator bookkeeping note, no ticket closed) by
this session's own Guardrails diligence (diff every merge/replay against
what it should contain, never trust a green "LAND_PUBLISHED" line alone).

## Timeline

1. `land_main_publish.sh . --land BL-1424-... bd1d6e097b` → `LAND_REPLAY
   land-replay/BL-1424-bd1d6e097b 002def27c6`, `LANDED_SIBLING BL-1445
   swarmforge/roles/hardender.prompt`, then `LAND_PUBLISHED
   002def27c6be2ecf9e2e273a4bfb76de6360e834`. Pushed successfully
   (`3a1acdc269..002def27c6`).
2. Reviewing the replay tip per this prompt's own instruction ("review that
   tip") found `git diff --stat 3a1acdc269 002def27c6` listed only 5 files.
   `git show 002def27c6:swarmforge/scripts/check_test_file_registration.sh`
   failed: the file did not exist on the pushed commit at all.
   `git merge-base --is-ancestor 569c8db073 002def27c6` (the real BL-1424
   documenter commit against the pushed tip) — **false**: the actual work
   was not even an ancestor of what got pushed.
3. Root-caused by direct invocation: `land-step-lib/land-plan` called with
   `:base` forced to `origin-main` (the old, wide, always-correct walk)
   returns `{:action :land}` — NO entanglement at all under the wide walk.
   The narrow walk (`task-scope-gate-lib/parcel-own-base` for `BL-1424`,
   what the unforced call actually used) evidently resolves to something
   that both (a) manufactures a false entanglement finding and (b) starves
   `full-delivered-paths`/`own-paths`' walk of the earlier coder/cleaner/
   architect/hardener commits, so only the tail (QA + documenter's last
   couple of doc edits) survived attribution.
4. A second, independent re-invocation of `land-plan` (unforced) against a
   FIX commit — built by merging the CORRECT `bd1d6e097b` back on top of
   the broken `002def27c6` — again returned `:action :replay` with a
   DIFFERENT wrong `own-paths`: this time it wanted to replay BL-1445's own
   files (`backlog/paused/BL-1445-....yaml`, its feature file, its topic
   record) as if they were BL-1424's, while still omitting the guard code.
   Confirms this is not a one-off fluke: the bounded-walk base resolution
   is unreliable across repeated `git merge origin/main` syncs into one
   long-lived ticket branch, in at least two different wrong ways on the
   same ticket within the same hour.
5. Given the tool could not be trusted a third time, the fix was landed by
   hand instead: merged the current (broken) `origin/main` into the
   verified-correct `bd1d6e097b` (`git merge origin/main`), confirmed `git
   diff --stat` against parent1 (the correct branch) was EMPTY — the merge
   result is byte-identical in content to the correct branch — and against
   parent2 (the broken push) showed exactly the missing files being
   restored. Confirmed `569c8db073` (real BL-1424 work) and `origin/main`
   were both genuine ancestors of the fix commit (fast-forward safe, real
   lineage preserved). Pushed directly under the standard lock discipline
   (acquire `.swarmforge/land-main.publish.lock`, fetch/verify fast-forward,
   `git push origin HEAD:main`, release) — the same manual recipe QA
   already uses for the Art Director's note-based tip lands, since the
   automated `--land` replay path could not be trusted for this specific
   base-resolution failure mode. `origin/main`: `002def27c6` → `2419ef1a6e`.
6. Verified every one of BL-1424's own files present on the new
   `origin/main` tip by name (`git show origin/main:<path>` for all nine
   functional files plus the manifest row) — all present.

## Why this is not a "the tool is escalating, adjudicate this one instance"
matter alone

`land-plan`'s docstring for `:base` explicitly promises: "Falling back to
`origin-main`... only ever WIDENS the walk, never narrows it past the
pre-existing behavior" — i.e., the bounded walk is meant to be a pure
performance optimization with no observable difference in *correctness*
from the old always-wide walk. This incident is direct, reproducible
evidence that promise does not hold for at least one real shape: a
long-lived ticket branch that has merged `origin/main` in more than once
before its land, while an entangled (but ultimately harmless/landed)
sibling's content rides along. Two independent bad answers on the same
ticket in one hour, both times differing from the (verified correct) wide
walk's `:land` verdict, is a correctness defect in `land_step_lib.bb`
itself (BL-1432's own bounded-walk feature), not a one-off fluke to wave
through.

**Recommendation for the specifier**: this needs its own defect ticket
(swarm-reliability, likely high — it silently pushed wrong content to the
shared `main` and would have gone unnoticed without this session's
own extra diff-against-both-parents diligence, which QA.prompt already
mandates but a busier pass or a different reviewer's judgment call might
have skipped). Suggested scope: `task_scope_gate_lib.bb`'s
`parcel-own-base`/`last-handoff-commit` resolution for a ticket whose
branch has merged `origin/main` more than once before landing; a repro
fixture along these exact lines (two `git merge origin/main` syncs, an
entangled-but-landed sibling touching one path in between) would pin it.
Until fixed, QA should treat any `LAND_REPLAY` verdict with elevated
suspicion and ALWAYS diff the replay tip's file list against the ticket's
own known deliverable list before trusting `LAND_PUBLISHED`, not just
against both merge parents — this incident's replay tip diffed cleanly
enough against ITS OWN two parents (origin-main and nothing, since it was
built as a synthetic root-like commit) to not trip the ordinary Guardrails
check by that route alone; what caught it was cross-checking against the
ticket's OWN known file list from the coder's evidence.

By QA.
