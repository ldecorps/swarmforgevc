# BL-1272 — QA verification clean, landing LAND_ESCALATE, 2026-08-30

## Verdict on BL-1272 itself: CLEAN

- Required wiring, both entries confirmed by direct grep against the merged tree:
  - `specs/pipeline/steps/index.js:891` registers `bl1272LandedSiblingSteps`.
  - `swarmforge/scripts/land_step_cli.bb`/`land_step_lib.bb` both print
    `LANDED_SIBLING <ticket-id>` (one line per resolved sibling), alongside the
    pre-existing `ENTANGLED_SIBLING` (now correctly filtered to `:unlanded`
    only).
- `entangled-siblings`/`land-plan`/`entanglement-note` read correctly: invariant
  1 (`sibling-landed?` requires `complete?` AND non-empty paths AND every path
  byte-identical — never an inference from silence or a subject grep) and
  invariant 2 (`land-plan`'s `:entangled` stays the FULL set; only the
  `:landed`/`:unlanded` reporting split is new) both hold by reading, not
  assumption.
- Unit-scope: `extension/test/bl1272LandedSiblingInvariants.property.test.js`
  — 3/3 pass (invariant 1 and invariant 2 properties).
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1272-a-landed-sibling-is-not-reported-as-entangled.feature`
  — 6/6 pass.
- Full unit suite (`npm test` in `extension/`): 226 failed / 9776 total, but
  every failure traces to already-ticketed, pre-existing debt unrelated to
  BL-1272's own diff (grepped per BL-1063 before writing this down):
  - `deps.checkOrphanedAuthoredDocs is not a function` (~16 files) → BL-1221.
  - `docs/deprecated/` missing, cited by constitution articles →
    BL-1172 epic.
  - `liveRepoDerivationGuard` (bl1243PaneActivitySignal, deprecateRetiredReferents,
    docsStructureRealTree) → BL-1291 / BL-1212.
  - `tempDirTrapGuard` (local_coder_battery.sh, three property runners) →
    BL-1289.
  - `telegramClient`/`telegramCursorBridgeCli`/`telegramCursorOperatorExec`
    (allows_multiple_answers, cursor/auto, ambulance active-only guard) →
    BL-1263 ("three standing assertions contradict deliberate source
    behaviour").
  - `topicMakeTopBridge` — `CURSOR_API_KEY` unset in this sandbox: a local
    environment gap, not a code defect.
  - `telegramFrontDeskBotCli` (8 tests) and its property sibling — see below,
    this IS live and NOT yet fixed despite two rounds through architect.

## Why this parcel cannot land as my own merge commit, or even at documenter's tip

Documenter's cumulative branch (cited commit `22f267b6e9`) carries several
OTHER tickets' unlanded work as first-parent ancestors back to `origin/main`
(`14478ca6c`): **BL-1183, BL-1224, BL-1235, BL-1240, BL-1250, BL-1253,
BL-1254**. This is ordinary long-lived-branch entanglement (BL-1241's own
shape), not misconduct — but one of them is NOT safe to carry onto `main`:

**BL-1240 is still broken.** I bounced it earlier today for exactly this:
`unregistered_test_gate_lib.bb`'s new load-file edge
(`(fs/path ... "test" "suite_inventory_lib.bb")`) is invisible to
`pinnedRepoFixture.js`'s `loadFileDeps`/`copyLiveScriptClosureInto` closure
walk, so any fixture that copies `swarm_handoff.bb`'s closure and then runs
it throws `FileNotFoundException: .../test/suite_inventory_lib.bb`. Direct
repro at THIS merge's tip, right now:

```
node -e '
const os=require("os"),fs=require("fs"),path=require("path");
const {copyLiveScriptClosureInto}=require("./test/helpers/pinnedRepoFixture.js");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bl1240-repro-"));
const scriptsDir=path.join(dir,"swarmforge","scripts");
fs.mkdirSync(scriptsDir,{recursive:true});
copyLiveScriptClosureInto(scriptsDir,["swarm_handoff.bb"]);
require("child_process").execFileSync("bb",[path.join(scriptsDir,"swarm_handoff.bb"),"/dev/null"],{cwd:dir});
'
```
→ `java.io.FileNotFoundException: <dir>/swarmforge/scripts/test/suite_inventory_lib.bb`,
same shape as my original bounce evidence
(`backlog/evidence/BL-1240-unregistered-test-fails-the-ticket-that-adds-it-bounce-20260830.md`,
since removed from this branch by an architect bounce-revert for a
DIFFERENT defect, `b92f2d8fa`). Architect's second review
(`BL-1240-architect-review-20260830.md`) called this compliant, but its own
listed checks don't mention re-testing the original fixture-closure
regression — the fix for architect's `loadFileDeps` finding did not also
fix mine. This is still live and directly explains 8 of the 226 unit
failures (`test/telegramFrontDeskBotCli.test.js`, and its BL-1203 property
sibling would be too). BL-1240 also carries its own separate spec-gap
(`required_wiring` entry 1 names the wrong file — already sent by documenter
as its own `note` to specifier + coordinator, per
`backlog/evidence/BL-1240-documenter-spec-gap-20260830.md`).

Landing my merge commit, or documenter's tip, as-is would put this broken
code on `origin/main`. Per BL-1241's own ruling and this constitution's
Article 1.8/BL-506, that is refused; the remedy is the land step's tip-pure
replay, not a bounce.

## The land step's own replay tool cannot complete — LAND_ESCALATE, new defect found

`land_step_cli.bb BL-1272-a-landed-sibling-is-not-reported-as-entangled
22f267b6e9 <repo-root>` correctly detects the full 7-ticket entanglement
(after I worked around two smaller issues below), then fails:

```
LAND_ESCALATE
BL-1272-...: entangled tip - sibling ticket(s) BL-1183,BL-1224,BL-1235,BL-1240,BL-1250,BL-1253,BL-1254 unlanded as ancestors, tip-pure replay could not complete cleanly; specifier adjudication needed.
land-step replay: nothing to commit for BL-1272 - own-paths identical to origin/main
```

**Root cause, isolated and reproduced directly (not part of BL-1272's own
diff — this is `task_scope_gate_lib.bb`'s pre-existing, shared
`own-commit-diff`, reused by `land_step_lib.bb`'s `own-paths` per BL-1272's
own out-of-scope note):**

`own-commit-diff` runs `git diff-tree --no-commit-id --name-only -r
--first-parent <commit>`. For a MERGE commit, plain `diff-tree` prints
NOTHING unless `-m` (per-parent) or `-c`/`--cc` (combined) is given — `git`
suppresses the diff of a merge commit by default, and `--first-parent` is a
`log`/`rev-list` traversal flag with no effect on `diff-tree`'s own diff
output. Confirmed directly:

```
$ git diff-tree --no-commit-id --name-only -r --first-parent dde87ca41   # empty
$ git diff-tree --no-commit-id --name-only -r -m dde87ca41 | head -3     # 19 paths, correct
```

`dde87ca41` ("Merge hardener BL-1272 (9f84cc220d) into documenter
worktree.") is the ONLY commit in the 11-commit first-parent walk from
`22f267b6e9` to `origin/main` whose subject names BL-1272 — and it is a
merge commit, which is the NORMAL shape for a role's own "receive the
handoff" commit throughout this pipeline (every stage does `git merge
<hash>` per Article 2/pipeline flow, then forwards). So `own-commit-diff`
silently returns `nil`/empty for it, `task-tagged-changed-paths` collapses
to `[]`, and `land_step_lib.bb`'s `replay!` reports "nothing to commit" —
not because there is nothing to replay, but because the walk cannot see it.

**Blast radius beyond this landing:** `task-tagged-changed-paths` is also
BL-1192's send-time gate's own walk (`parcel-own-changed-paths`) and is
explicitly reused by BL-1240's `unregistered_test_gate_lib.bb` ("asks the
same question of the same parcel and must never answer it differently" per
its own docstring). If either of those also cites a merge-commit-shaped
"parcel", the SAME silent-empty result applies — and both of those gates
read empty findings as fail-open/no-violation, per
`findings-for-git-handoff`'s own contract. I have not verified whether either
gate is actually invoked with a merge-commit citation in real operation (out
of scope for tonight's pass), but the shape is generic to
`task_scope_gate_lib.bb` itself, not specific to the land step, so this is
worth checking, not assuming.

**Two smaller issues hit while reproducing this** (recorded for whoever
picks this up, not blocking, both self-corrected):
1. Running `land_step_cli.bb` with no explicit `[repo-root]` from a LINKED
   worktree (my own `.worktrees/QA`, where `.git` is a plain gitlink FILE,
   not a directory) makes `replay!`'s `(fs/path root ".git"
   "land-replay-worktrees" ...)` construct a path under a file — `git
   worktree add` then fails outright.
2. `replay!`'s "could not create worktree" failure path does not delete the
   branch `git worktree add -b` may have already created before the
   worktree-checkout half failed, so a re-run with the SAME task+commit
   (deterministic branch name) fails a SECOND time for a different reason
   (`-b` refuses an existing branch). I cleaned up the stray
   `land-replay/BL-1272-80480e1131` branch by hand
   (`git branch -D land-replay/BL-1272-80480e1131` in the main checkout) to
   get past this.

## Disposition

Per QA.prompt's own LAND_ESCALATE contract ("not a bounce to the author — a
`note` (priority 00) to the specifier naming the conflicting paths, and
stop"): this is that note. Not bouncing BL-1272 — its own work is clean and
none of the above is in its diff. Not attempting a hand-rolled replay either
— the prior BL-1241 follow-up (`16062880b`) deliberately moved QA off
hand-rolling and onto this tool, and hand-rolling around a tool that fails
for a reason I don't fully own (a shared library's merge-diff blind spot)
risks compounding rather than fixing it.

What I did NOT do: `main` and `origin/main`'s own QA.prompt content is
stale relative to what `swarmforge/roles/QA.prompt` on THIS worktree branch
carries (neither has the `LAND_CLEAN`/`LAND_REPLAY`/`ENTANGLED_SIBLING`/
`LAND_ESCALATE`/`land_step_cli.bb` prose from `16062880b` at all — that
commit is not an ancestor of either `main` or `origin/main`, only of my own
worktree branch's earlier history). BL-1272's own ticket notes say the
specifier would land the `LANDED_SIBLING` prose addition to `QA.prompt`
directly on `main` "in the same pass" the ticket activates, and asked
whoever reaches documenter to say so if that's still undone — it reached me
undone; documenter's own commit (`22f267b6e9`) doesn't mention checking it.
Surfacing both gaps (the missing `LANDED_SIBLING` prose AND the fact that
the EARLIER `16062880b` prose itself never reached `origin/main`) in the
note rather than fixing `QA.prompt` myself — that file is specifier-owned
(Article 1.2).

## What's needed next (specifier adjudication)

1. BL-1240's fixture-closure regression is still live at this tip and needs
   its OWNING role (coder, same as my original bounce) to actually fix it —
   currently stuck behind its own separate `required_wiring` spec-gap.
2. `task_scope_gate_lib.bb`'s `own-commit-diff` needs `-m`/`-c` (or an
   explicit `git diff <first-parent> <commit>`, which I confirmed by hand
   returns the correct 19 paths) to handle merge-commit citations — this is
   pre-existing, shared, and worth its own ticket given the blast radius
   noted above.
3. Once (2) is fixed, BL-1272's own landing should be re-attempted through
   `land_step_cli.bb` normally — no further action needed on BL-1272's own
   code, it is done.
4. The `LANDED_SIBLING` QA.prompt prose (and the still-unlanded `16062880b`
   prose it builds on) needs landing on `main`/pushing to `origin/main` per
   the ticket's own commitment.

By QA.
