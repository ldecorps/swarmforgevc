# BL-1196 — specifier adjudication: a false closure, and the root cause nobody had (2026-08-28)

Answers hardener note `000926` (priority 00, 01:32:39Z): *"property-suite-guard
run hijacked hardener ref 2x, recovered, see evidence"*, backed by the
hardener's own evidence commit `62da72445`.

The hardener did everything right: recovered twice, declined to re-run the
suite to reproduce, and surfaced it as a note rather than a bounce because it
is machinery, not a defect in anyone's parcel.

## The report was NOT a duplicate, and the standing guidance to treat it as one was wrong

Standing guidance said this symptom was already ticketed and re-reporting it
achieved nothing (BL-1202 detector, BL-1200 + BL-1196 prevention). Checked
per-ticket rather than trusted:

| Ticket | Believed | Actual |
|---|---|---|
| BL-1200 | shipped | **shipped** — genuinely done, merged into the hardener's own branch (`e1f98cfbf`) *before* tonight's hijack |
| BL-1202 | pending human | approved, `paused/`, unbuilt — detector half, correctly scoped |
| BL-1196 | shipped (`done/`) | **never built** |

BL-1196 is the prevention half for the JS property lane, and it is the one
that was supposed to stop exactly this. It is `status: todo`. Verified:

- `git log --all --oneline -- extension/test/helpers/gitEnvGuardSetup.js` →
  empty. The reflog by path → empty. **No commit in any ref ever authored the
  file this ticket specifies.**
- Neither `extension/vitest.config.mjs` nor
  `extension/vitest.properties.config.mjs` registers any git-env guard in
  `setupFiles`.
- The only `GIT_DIR`/`GIT_WORK_TREE` stripping in the repo is opt-in
  (`sharedRepoFixture.js:35-36`). `GIT_INDEX_FILE` is stripped **nowhere**.

## How an unbuilt ticket reached `done/`

Coordinator commit `f8a41c1e2` swept "stale duplicate source paths" for seven
tickets. BL-1196 was one of the four whose two copies were byte-identical, so
it was moved and the move was later confirmed correct — by a specifier pass
(mine) that asked whether the two copies agreed on a pool, never whether the
work had happened. Those are different questions and only the first was
checked. The earlier disposition note recorded "BL-1196 → `done/`… all four
tickets now sit in a correct pool"; that sentence is wrong and is corrected by
this file.

The compounding cost is in BL-1196's own `out_of_scope`: it deliberately left
~60 per-file `git()` helpers untouched, on the explicit reasoning that a
central guard would "make their current shape safe by construction". The
central guard was never written, so those ~60 call sites have been unprotected
the entire time, believed safe.

## Root cause — proven, and not what the ticket was minted on

Both BL-1196 and BL-1200 assumed the ambient redirect came from an operator's
shell. It does not. **Git exports it into every hook it runs.** Measured in an
isolated scratch repo (never against this one):

Committing from a **linked worktree** gives the `pre-commit` hook:

```
GIT_DIR=<main>/.git/worktrees/<name>              (absolute)
GIT_INDEX_FILE=<main>/.git/worktrees/<name>/index (absolute)
```

with `GIT_WORK_TREE` unset. A child that `cd`s **outside the repo entirely**
still resolves to that gitdir and reports `HEAD -> refs/heads/<branch>`.

`check_property_suite_drift.sh` then runs
`run_default_suite() { (cd extension && npm run test:properties); }` with **no
env scrubbing**, so every fixture inherits it. A fixture doing mkdtemp → `git
init` → `git commit` does not get an isolated repo: it writes the triggering
role's branch ref and clobbers that worktree's index.

This accounts for every observation the earlier tickets could not:

- **Why it fires on routine work.** Only the hook path has these variables. A
  manual `npm run test:properties` from a clean shell is harmless — which is
  why "never run it to reproduce" was good advice built on a wrong model.
- **Why the ref and index are hit but the working tree is spared.** Git does
  not set `GIT_WORK_TREE`, so the work tree falls back to cwd. The hardener
  observed exactly this. It is luck of the shape, not a guarantee.
- **Why BL-1200 looked like a different bug.** From the main checkout `GIT_DIR`
  is unset and `GIT_INDEX_FILE` is *relative* — a different presentation of one
  vector, which is why it was minted as a sibling.
- **Why the existing property test cannot catch it.** Its own test name scopes
  it to "a decoy named only by GIT_DIR/GIT_WORK_TREE".

## Disposition — amend (Article 3.6), not retire, not a new ticket

The premise is not stale; it is live and freshly re-confirmed. BL-1196 is
amended in place rather than superseded, so its approval, evidence and source
notes stay attached. Amendments:

1. **`GIT_INDEX_FILE` moves into scope.** The old `out_of_scope` deferred it
   with a stated condition — *"widen only if a future incident actually
   implicates one"*. Tonight's incident implicates it directly: the damage was
   the ref **and the index**, and in the master-checkout case it is the only
   variable set at all. The human pre-authorised this widening; this is it.
2. **A second enforcement site**: scrub the ambient git env where
   `check_property_suite_drift.sh` launches the suite. The setupFile covers
   code inside vitest; the invocation-site scrub also covers every subprocess
   the suite shells out to — including the shell fixtures that were BL-1200's
   writer, which a setupFile can never reach.
3. `human_approval: pending`. The variable widening was pre-authorised, but
   site (2) is genuinely new and the feature file changed, so it goes back for
   review rather than being self-blessed. Flagged in `approval_context` with an
   explicit offer to split (2) out if only the setupFile half is wanted.
4. Feature file: two scenarios added (03 index-redirect stripped, 04 the
   worktree hook environment). `gherkin_lint_gate.sh` clean. IR-DRY: 6
   medium-confidence possible-synonym findings, all reviewed and deliberately
   left separate — per-variable assertions and decoy-vs-target repos, where
   merging would erase exactly the per-variable specificity whose absence
   caused this (GIT_DIR covered, GIT_INDEX_FILE not).
5. No step handlers exist for any of this ticket's scenarios, since it was
   never built. The coder must land handlers for all four in the same parcel
   (BL-233).

**Severity deliberately left at `high`, not raised.** Every occurrence was
recovered with no data loss. Raising it to buy a promotion slot would be the
urgency theatre the specifier prompt warns against. The honest argument for
`critical` — that it now fires unattended on ordinary commits, and a role that
does not notice forwards a corrupted branch — is recorded in
`approval_context` for the human to weigh.

## Occurrence count

Five hits, four roles, two days, with the prevention sitting in `done/`
throughout:

| When | Role | What |
|---|---|---|
| 08-27 18:10 | coder | property fixture leaked GIT_DIR (this ticket's mint) |
| 08-27 18:26 | hardener | role branch carried 45 commits past its real merge |
| 08-27 19:31 | specifier | master checkout detached, 20 fixture commits (BL-1200) |
| 08-28 ~02:30 | hardener | `swarmforge-hardender` → `02d436e8d` "seed" |
| 08-28 ~02:30 | hardener | same commit, again → `fea3d5ea5` |

## Follow-up NOT minted here, deliberately

No gate asks whether a ticket moved to `done/` has an implementing commit.
**BL-1215** already installs exactly that check ("verify the run's
implementation commit is reachable from `origin/main`" before landing) at the
*pilot acceptance gate*. The same check is owed at the coordinator's Article
3.3 `active/ → done/` move and at any bulk pool sweep — which is the site that
failed here. Recorded as a named candidate rather than minted, so it is
decided deliberately alongside BL-1215 rather than reflexively duplicating it.

By specifier.
