# Operator: main-sync dirty-overlap cleared (BABYSITTER_ESCALATION main-sync-deadlock)

Operator run 2026-09-04T09:35Z–09:42Z (UTC). Two escalations processed; both resolved.

## 1. main-sync deadlock — CLEARED

**State found:** master checkout carried 65 staged paths (44 `A` + 21 `M`) against HEAD,
with **no `MERGE_HEAD`**, no `index.lock`, and **zero** unstaged delta (index == worktree).
Local main was `ahead=12 behind=15` of `origin/main` (now `12/17`). This staged tree was the
redundant local replay of the BL-1296 / BL-1376 / BL-1377 / BL-1378 landing that QA had
already pushed to `origin/main`.

**Subsumption verified BEFORE clearing** (this is the check that made the clear lossless —
per the standing "erased approval is invisible" hazard, a dirty-overlap clear is only safe
once every staged byte is proven to exist upstream):

- 61 of 65 staged paths were **blob-identical** to `origin/main` (`git rev-parse :$f` ==
  `git rev-parse origin/main:$f`).
- 0 staged paths were absent from `origin/main`.
- 4 differed, and in all 4 `origin/main` is the **newer** side — it carries BL-1309 /
  BL-1374 / BL-1375 content that local HEAD lacks:
  - `backlog/paused/BL-1296-bubble-answers-from-its-own-seat.yaml`
  - `docs/index.md`
  - `docs/reference/Specification.MD`
  - `swarmforge/scripts/test/suite-manifest.tsv`
- Every **unique addition** those 4 staged copies held was individually confirmed already
  PRESENT in `origin/main`: `test_bl1376_expedite_branch_handover.sh`,
  `test_bl1378_expedite_close_guard.sh`, `suite_baseline_lib_test_runner.bb`,
  `test_suite_baseline_cli.sh` (suite-manifest rows); the BL-1377/BL-1378/BL-1296 how-to
  rows in `docs/index.md`; the `BL-1378: the close guard` section in `Specification.MD`;
  and `abandoned_commits` SHA `359a2c8e66` in the BL-1296 yaml.

**Action:** `git restore --source=HEAD --staged --worktree` over exactly those 65 paths.
No commit, no reset, no merge, no push. Working tree is now clean vs HEAD.

**Reversible:** the pre-clear index tree is preserved as a commit at
`refs/operator/pre-main-sync-clear-20260904` = `afecd57b773c0f1847e333be8cf161869322ba84`.
Recover any path with `git checkout afecd57b77 -- <path>`.

**Untracked left untouched:** all 16 `??` paths were checked against `origin/main` — none
overlaps, so none blocks a merge.

**HEAD moved under the operator mid-run** (`ae1e50a342` → `d3ac29b58a`): the coordinator
committed `Approve BL-1386` (`15f9fc932d`) and `Approve BL-1387` (`d3ac29b58a`) while the
65 paths were still staged. Both were verified pathspec-scoped single-file commits — the
staged overlap was **not** swept into either. (Standing hazard, checked deliberately.)

## 2. What is NOT done — the merge itself

Local main is `ahead=12 behind=17`. That is not a fast-forward, and **handoffd will not do
it**: the BL-1386 stopgap (`8abf8d054b`) set `config master_main_reconcile_enabled false`
in `swarmforge/swarmforge.conf`, and `master_main_reconcile_lib.bb` reads
`swarmforge/swarmforge.conf` directly — the `true` still sitting at
`swarmforge/packs/full-forge.conf:110` is **not consulted**, so the stopgap is genuinely in
force. This is not a config false alarm.

Bringing local main up to `origin/main` is the coordinator's or the human's call, not the
operator's (no operator commits to main while the swarm runs). Standing hazards for whoever
does it: a bare `git merge origin/main` on main has previously **dropped origin landings**,
and a main-sync merge subject must never name a ticket id (`task_scope_gate`).

## 3. Article 4.2 flag on `5cd86ec8b3` — FALSE POSITIVE, self-clearing

`BL-1309: tip-pure replay onto origin/main (BL-1241 land-step remedy, hand-built)`.

- `swarmforge/scripts/is_qa_ancestor.sh 5cd86ec8b3` → exit **1** (the lag pattern).
- `git rev-list --count swarmforge-QA..main` → **11**.
- `git branch -a --contains 5cd86ec8b3` → `origin/main` only; not local main, not QA.

Article 4.2's predicate is ancestry-only, so a QA hand-land always flags while local main
lags. Same root cause as §1; clears itself once local main catches up. No ticket — this is
the already-recorded 5th exemption gap, not a new finding.

The coordinator independently reached this same verdict in its own pane before the operator
ran, and correctly held position without touching main.

## 4. CORRECTION / real root cause — the latch is structurally stuck

Clearing the dirty overlap (§1) was correct hygiene but was **not** the blocker. The latch
`.swarmforge/daemon/main-sync-deadlock.json` read:

```json
{"active":true,"reason":"human-merge-in-progress","ahead":4,"behind":2,
 "overlapping_paths":[],"tripped_at":"2026-09-04T08:33:35.215156890Z","alerted":true}
```

`overlapping_paths` is **empty** — dirt never tripped it. `human-merge-in-progress` is gated
on `merge-head-present?` (`master_main_reconcile_lib.bb:177/238`), i.e. a real `MERGE_HEAD`
that existed at 08:33:35Z and is now gone — the BL-1386/BL-1387 orphaned merge. The latch
was left behind, and its `ahead`/`behind` (4/2) are stale against the live 12/17.

**Why it cannot clear itself:**

- `deadlock-clear?` is `(zero? behind)` (`master_main_reconcile_lib.bb:659-662`), and
  `handoffd.bb:3604-3607` clears the latch only under that predicate.
- The only thing that reduces `behind` is `master-main-reconcile-sweep!`
  (`handoffd.bb:3506`), whose merge is gated on `(master-main-reconcile-enabled?)`
  (`handoffd.bb:3511`).
- The BL-1386 stopgap `8abf8d054b` set that flag **false**.

⇒ `behind` stays 17, the latch stays `active:true`, and coordinator bookkeeping stays halted
**indefinitely**. This is work stalled with no auto-recovery. The stopgap for BL-1386 and the
clear-condition for the BL-1187 latch are mutually exclusive; nothing reconciles them.

**Operator action:** escalated to the human as a single ASK on thread `SUP-17` with four
discrete options (coordinator hand-merges / operator hand-merges under human command /
re-enable the reconcile / leave halted until BL-1386+BL-1387 land). No merge, no commit, no
config flip by the operator — the remedy is the human's call. Awaiting the answer; a later
operator run will act on it.
