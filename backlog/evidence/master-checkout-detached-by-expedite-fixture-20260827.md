# Evidence — the master checkout lost `main` and ran detached while a test fixture committed to the live repo

**Found by:** specifier, 2026-08-27 ~19:31–19:35 BST, while minting BL-1199.
**Class:** same root cause as **BL-1196** (ambient `GIT_DIR`/`GIT_WORK_TREE`
inherited by test git fixtures), escalated from "tests fail" to "tests write
to the live repo".

## What the specifier walked into

Mid-mint, `git status` on the master checkout went from a normal dirty tree to
`nothing to commit, working tree clean`, and `git log --oneline -3` returned:

    3a4d0f4dd init
    f000698d8 init
    644ba813a init

`git rev-parse --abbrev-ref HEAD` returned `HEAD` — **the master checkout was
running detached**, and `main` had been moved out from under it.

## Confirmed facts (each re-read from git, none inferred)

1. **Ambient redirect is live in the agent pane.**
   `GIT_DIR=/home/carillon/swarmforgevc/.git` and
   `GIT_WORK_TREE=/home/carillon/swarmforgevc` are set in the specifier's
   environment. No swarm script exports them
   (`grep -rn 'export GIT_DIR' swarmforge/scripts .swarmforge/launch` — no
   hits), so they arrive from outside the swarm's own launchers.

2. **The writer is a shell test fixture.**
   `swarmforge/scripts/test/expedite_fixture.sh:41` runs `git init -q -b main .`
   and `:43` `git config user.name "expedite fixture"` with **no**
   `GIT_DIR`/`GIT_WORK_TREE` clearing and no `env -u`. With the redirect
   ambient, every one of those calls lands on the real repository regardless of
   the fixture's own cwd — `GIT_DIR` overrides `git -C`. Its callers are
   `test_expedite_cli.sh`, `test_bl1023_expedite_bookkeep.sh`,
   `test_expedite_qa_verdict_store.sh`.

3. **Twenty bogus commits reached local `main`,** authored `expedite fixture`:

       f955e2175  08-27 19:31  expedite fixture  seed fixture corpus
       c1f920a5a  08-27 19:31  expedite fixture  Cost & health sidecar for 2026-08-27
       def770101  08-27 19:31  expedite fixture  init
       ... 10 more "init" at 19:31 ...
       93bad9bf2  07-02 12:00  expedite fixture  close
       097ec368b  07-02 08:00  expedite fixture  promote
       ... (the 07-02 dates are the fixture's own pinned clock) ...

   `git show --stat` on `f955e2175` and `def770101` reports **no file changes**:
   they are empty commits. **No content was lost or altered** — the damage is
   ref state and history noise, not tree corruption. `origin/main` (`2c17daf6c`)
   is still an ancestor of local `main`; `git rev-list --left-right --count
   main...origin/main` = `21 0` (ahead 21, behind 0).

4. **Real work is mixed in with the noise.** Of the 21 local-ahead commits, at
   least `a91574c7d "Approve BL-1198: record human_approval"` is a genuine bot
   commit. **Nothing in this range may be discarded wholesale** — this is
   exactly the shape BL-1198 was minted for earlier the same day (a rematch or
   `reset --hard origin/main` here would throw away real, unpushed commits).

5. **`main` is checked out in a stray worktree.**
   `git branch -f main <tip>` refuses:

       fatal: cannot force update the branch 'main' used by worktree
       at '/tmp/specifier-main-main'

   `git worktree list` confirms `/tmp/specifier-main-main  f955e2175 [main]`,
   directory created **17:40 today**. The master checkout therefore cannot
   reattach to `main` while that worktree holds it. **Not repaired by the
   specifier** — it is not a path the specifier created, and it may be an
   operator session's own worktree (`/tmp/coord-main-827`,
   `/tmp/coordinator-briefing-20260827`, `/tmp/origin-main-test` sit beside it
   with the same shape). Ownership question raised to the human rather than
   guessed.

## Consequence while it stands

Every master-resident role (specifier, coordinator) commits onto a **detached
HEAD**. Commits are reachable and nothing is lost, but they are not on `main`,
they will not be pushed by the normal push sweep, and the next `git checkout`
by anyone makes them reflog-only. BL-1199's own mint landed this way
(`f000698d8` added the ticket YAML; `e8f7f37b9` is the bot's approval of it —
both on the detached line, not on `main`).

## Disposition

- Root cause is **BL-1196** (approved, paused, `severity: high`). Its scope
  description named the ~60 JS `git()` helpers under `extension/test/`; this
  incident proves the **shell** fixtures under `swarmforge/scripts/test/` carry
  the identical defect. BL-1196 amended to name both surfaces.
- BL-1196 needs a **promotion slot**, not another ticket. It has now been
  demonstrated live, not merely predicted.
- The stray `/tmp/specifier-main-main` worktree holding `main`, and whether the
  21 local-ahead commits should be pushed as-is or tidied, are **ops decisions**
  surfaced to the coordinator and the human — deliberately not actioned here.

## Not blamed on this incident

The large pre-existing pile of `/tmp/sfvc-bl1106-prop-*`, `/tmp/bl*-pure`, and
`.worktrees/expedite-BL-*` worktrees predates today and is out of scope, per the
same baseline discipline the BL-1191 restart-gate intake asks for.

## Addendum — the operator's uncommitted work was committed by a fixture

At session start the master checkout carried the human's in-progress pack-switch
edits as unstaged modifications: `start-swarm.sh`, `start-swarm-anthropic.sh`,
`swarmforge/packs/openrouter-anthropic-mono-router.conf` and `.prompt`,
`swarmforge/scripts/swarmforge.sh`, and
`backlog/active/BL-592-spec-tree-on-live-console-with-epic-tier.yaml`.

They are no longer modified because a fixture committed them:

    git log -1 -- start-swarm.sh swarmforge/packs/openrouter-anthropic-mono-router.conf
    9e938a68e  Test init          (author "Test", 19:30)

**Nothing was altered or lost** — the content is exactly what the human had on
disk. But it was committed without the human's intent, with a fixture's commit
message, onto the detached line rather than `main`. Anyone who reads
`git status` now sees a clean tree and would reasonably conclude the human's
pack-switch work was deliberately landed. It was not. Flagged here so the
recovery does not mistake a fixture's `git add -A` for a human's decision.
