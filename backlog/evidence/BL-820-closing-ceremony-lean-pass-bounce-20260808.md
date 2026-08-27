# BL-820 closing-ceremony-lean-pass — QA bounce — 20260808

## D1 — cleaner's pass for BL-820 is untraceable (Article 4.4)

**Failing command:**

```sh
git log --oneline 09edd805..eb48c047 -- extension/src/tools/closing-ceremony-run.ts \
  extension/src/quality/closingCeremony.ts extension/src/metrics/closingCeremonyStore.ts
# (no output)

git log --all --source --oneline -- extension/src/quality/closingCeremony.ts
# efc7d9f4  refs/heads/swarmforge-hardender  Hardener pass: BL-820 ...
# 09edd805  refs/heads/swarmforge-cleaner    BL-820: closing-ceremony lean pass

grep -rl "BL-820" backlog/evidence/
# backlog/evidence/BL-650-blocked-20260806.md   (unrelated passing mention)
# backlog/evidence/BL-820-architect-pass-20260808.md
```

**Commit hash tested:** `4c3c273c4a1230251775779d1431e5b662ed1d0e` (documenter's
forward, received in_process from documenter as
`00_20260808T194531Z_000055_from_documenter_to_QA_for_QA.handoff`).

**First error excerpt / observation:** `refs/heads/swarmforge-cleaner`'s own tip
for every file BL-820 touches is `09edd805` — the coder's own commit, byte-
identical to what architect's evidence file (`backlog/evidence/BL-820-architect-
pass-20260808.md`) explicitly names as "Commit reviewed: 09edd805..., received
from cleaner as part of the forward tipped at 4ad363eed5" — and `4ad363eed5` is
itself a **different ticket's** (BL-856) coder commit (`By coder.`), not a
cleaner commit. There is no commit anywhere in reachable history (`git log
--all`) authored as a cleaner pass touching any of BL-820's 9 changed
`extension/src/**` files, and `backlog/evidence/` has no
`BL-820-cleaner-pass-*.md` (nor any batch file naming BL-820 alongside a
sibling ticket). Cleaner forwarded coder's commit onward with zero changes of
its own and zero evidence of having reviewed it.

**Failure class:** `behavior` — matches the precedent in this QA prompt's own
routing table ("a stage's pass is MISSING ENTIRELY... Failure class never
drives routing — ownership does; class is the metric label. `behavior` was the
honest class for BL-575's missing documenter pass").

**Expected vs observed:** Expected — per Article 4.4 ("A clean pass leaves a
commit, or it is indistinguishable from a skipped stage") — either a
cleaner-authored commit with DRY/readability changes, or an explicit-NONE
`backlog/evidence/BL-820-cleaner-pass-<date>.md` committed to the cleaner
branch before forwarding. Observed — neither exists; cleaner's pass for BL-820
is indistinguishable from a skipped stage.

## Blocked checks

None. Every other check in this pass ran to completion (see below) — this
finding does not block any downstream check, it is the only defect this pass
found.

## Everything else this pass checked (for completeness — Article 4.4 "complete
inventory", not first-failure-stop)

- **Merge/lineage:** `4c3c273c4a` is a real commit (not a prior QA-approved
  ancestor of `main`; `git merge-base --is-ancestor 4c3c273c4a main` = false).
  Merged clean (fast-forward) into the QA worktree.
- **Compile:** `npm run compile` — clean.
- **Unit suite:** 7366/7367 passed. The one failure
  (`test/renderBriefingDiagramsCli.test.js`, a 20s timeout) touches no file
  BL-820 changed and reran 4/4 green in isolation immediately after — a
  load-driven flake (host load 21-40 throughout this pass on what the
  hardener's own commit documents as a 4-core box), matching the hardener's
  own commit message prediction of this exact flake.
- **Property tests:** `closingCeremonyInvariant.property.test.js` (BL-820's
  own declared invariant) — 2/2 passed, confirmed again in isolation. 6
  unrelated failures elsewhere in the property suite (BL-787, BL-797, etc.) —
  none touch a BL-820 file; consistent with the same load-driven flakiness.
- **Acceptance:** `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-820-closing-ceremony-lean-pass.feature` — 12/12 scenarios
  passed. Step handlers drive the real compiled modules, not a
  reimplementation.
- **Wiring:** confirmed real caller —
  `swarmforge/scripts/finish_shift_lib.sh:65 finish_shift_run_closing_ceremony`
  is called from `./finish-shift:60`, ahead of the pipeline kill; fails open
  on missing compile or non-zero exit (does not block bedtime).
- **Docs/diagram:** `docs/reference/BL-820-closing-ceremony-lean-pass.md` is
  thorough and accurate against the shipped code; `docs/diagrams/
  architecture.mmd` gained the `lean/ceremony/` node and its edges;
  `coordinator.prompt` and `specifier.prompt` both document the new duty
  consistently with the shipped CLIs.
- **Architect pass:** clean, evidence committed
  (`BL-820-architect-pass-20260808.md`) — dependency gate, co-change, two-layer
  boundary, secrets, policy/IO separation all checked.
- **Hardener pass:** clean, evidence committed inline in commit `efc7d9f4`
  (not a separate evidence file, but a real commit with real diff) — CRAP <= 6
  achieved via behavior-preserving splits, DRY via a shared
  `resolveTargetAndNow()`/`isValidShiftKey`, jscpd 0 clones. Mutation run
  itself deferred under the BL-149 cooldown gate's documented office-hours
  load bypass (host load 8-43 throughout) — a legitimate, documented
  deferral, not a gap.
- **Orphaned processes:** none before or after this pass
  (`pgrep -fl 'node --test|stryker'`).

## Remediation pointer

Owning role: **cleaner**. Re-run an actual cleaner review pass against
commit `4c3c273c4a`'s BL-820 files (`extension/src/tools/closing-ceremony-*.ts`,
`extension/src/quality/closingCeremony.ts`,
`extension/src/metrics/closingCeremonyStore.ts`,
`extension/src/metrics/closingCeremonyRun.ts`) and commit the result — either
real DRY/readability changes, or (if genuinely nothing to clean, plausible
given the code is already small and well-factored per the hardener's own
pass) an explicit-NONE evidence file
`backlog/evidence/BL-820-cleaner-pass-<date>.md` — before forwarding again
through architect → hardener → documenter → QA.

## Bounce-hygiene note

This bounce's reviewed commit (`4c3c273c4a`) is not an ancestor of `main`
(verified above), so no revert-from-main exception applies. My QA-worktree
merge of it was a plain fast-forward (no separate QA review-merge commit of
my own exists to revert) and my branch is not a base any other role's forward
builds on — QA is terminal (approve → `main`, or bounce → no `main` landing);
leaving my branch at this unapproved commit does not misrepresent it as
approved and does not contaminate any other ticket's lineage. No further
action taken on my branch.
