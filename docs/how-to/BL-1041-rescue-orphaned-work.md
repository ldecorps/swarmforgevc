# BL-1041: Rescuing orphaned work with `rescue_orphaned_work.bb`

How to pull work that is sitting outside any branch — a stash entry with no
worktree, most often — back onto one, without the rescue itself becoming
the way the work gets lost.

## The incident this closes

On 2026-08-22 a reviewed-sound fix (a `stageOfSeat` helper for BL-981) had
been sitting in a repo-wide `git stash` with no worktree for two days,
flagged twice by the specifier as at-risk. A rescue applied it into
`.worktrees/coder` and dropped the stash entry in the *same* operation. For
about an hour the only two copies of that work were an uncommitted working
tree and an evidence file a specifier happened to have hand-copied while
writing an unrelated ticket — not a mechanism. A `git restore`, a crash
sweep, or a worktree reset in that window would have destroyed it. The
receiving role (coder) also found the uncommitted changes with no
explanation, could not commit them (not its ticket) or remove them (not its
file — "ticket-less changes you did not make are surfaced, not swept"), and
burned a turn establishing provenance.

The rescue was well-intentioned and the work genuinely needed rescuing. The
defect was moving it from a durable-if-obscure place (a stash entry) to a
volatile one (an uncommitted tree) and destroying the original in the same
step. **A rescue that can lose the thing it rescued is not yet a rescue.**

## What it guarantees

1. **The source is never released before a verified commit exists.** The
   rescued content lands as a commit on a branch, and that commit's content
   is read back and compared before the source stash entry is dropped.
   Interrupted at any point before that verification, the stash entry is
   still there and nothing has been lost.
2. **The receiving role is told.** A rescue writes a `note` draft naming
   what landed, how many files, and the commit sha — because a role may not
   sweep changes it did not make, so unattributed work in its tree costs it
   a turn it cannot avoid otherwise.

Both are declared invariants, backed by a property test
(`bl1041_rescue_durability_property_runner.bb`) that replays the full
ordering, and an end-to-end suite
(`swarmforge/scripts/test/test_rescue_orphaned_work.sh`) against real
throwaway git repos — the ordering is a property of real git state, so no
fake establishes it.

## Run it

```sh
swarmforge/scripts/rescue_orphaned_work.bb <project-root> \
  --stash <ref> --role <role> --reason <text> [--dry-run]
```

- `<ref>` — the stash reference to rescue (e.g. `stash@{0}`).
- `<role>` — whose worktree receives it (`.worktrees/<role>`, falling back
  to `<project-root>` if that worktree doesn't exist).
- `--reason` — free text, becomes part of the commit message and the
  notification (defaults to `"orphaned work rescue"`).
- `--dry-run` — prints the ordered plan and exits, touching nothing.

The CLI **applies**, never **pops** — the source stash entry is only ever
dropped after verification succeeds (step 4 below).

## What it does, in order

The order is the whole safety property, so it is returned as data
(`rescue-lib/rescue-plan`) that a test can assert over, rather than left
implicit in the CLI's control flow — which is where the original mistake
lived:

1. **Read the source's own path set** — `git stash show
   --include-untracked --name-only <ref>`, from the *source*, before
   touching the receiving worktree at all.
2. **Stage**: `git stash apply <ref>` into the receiving worktree.
3. **Commit** onto the role's branch — only the paths the stash itself
   touched, never whatever else the tree happened to be carrying.
4. **Verify** by reading the content back *out of* the commit and comparing
   it to disk — never by trusting the commit's subject line. A path the
   stash *deletes* verifies as absent from both the commit and disk, not by
   requiring it to exist (a naive "does it exist on disk" check can never
   pass for a legitimately rescued deletion, which would retain the source
   forever — closed by the hardener pass on this ticket).
5. **Release the source** — `git stash drop <ref>` — but only when
   `source-release-allowed?` holds: a commit sha exists, it is reachable
   from a branch, and its content is verified. This step carries that guard
   explicitly; it is not reached by falling through.
6. **Notify** the role whose worktree was touched: a `note` draft (priority
   `00`) is written to `tmp/rescue-note.txt` in that worktree, naming the
   file count, the commit sha, and (space permitting) the reason.

If verification fails, the CLI still reports the commit it made but leaves
the source stash entry in place (`"source RETAINED - content not verified,
nothing dropped"`) rather than silently losing anything.

## Why the path set comes from the stash, not the tree

The first version derived "what changed" from `git diff --name-only HEAD`
*after* the apply — "everything currently uncommitted in the tree." An
architect bounce found this wrong two ways, both reproduced end-to-end:

- It swept the receiving role's **own pre-existing uncommitted work** into
  the rescue commit, under a message describing something else — the exact
  harm this ticket exists to prevent, now automated rather than manual.
- `git diff` never reports untracked files, so a stash whose orphaned work
  was a brand-new file came back empty: the CLI applied it (the file landed
  on disk) but refused with a misleading "changed no tracked file," leaving
  that file unaccounted for.

The fix reads the changed-path set from the stash itself
(`--include-untracked`) before the apply touches the worktree, so the
receiving tree's own state can never contaminate what gets committed.

## The notification

```
type: note
to: <role>
priority: 00
message: rescued <N> file(s) into your worktree as <sha> - <reason>
```

Capped at 80 characters — not cosmetic. `swarm_handoff.sh` **refuses** a
draft whose `message` exceeds that cap and prints its usage block instead
of sending, so an over-long draft notifies nobody, precisely the harm the
notify step exists to prevent. When the cap bites, the *reason* is trimmed;
the commit sha is always kept in full, because the sha is what makes the
note actionable — the owner reads the content for themselves from there.
The file count is always stated (never a silently shortened path list).

## Boundary: what this is not

- **Not `salvage_lib.bb`.** That script salvages *handoffs* — abandoning a
  stale parcel and re-injecting it at a pipeline stage — not orphaned
  *code*. Nothing in `swarmforge/scripts` touched a stash before this
  ticket; the original rescue was done by hand, which is why no mechanism
  enforced the ordering.
- **Not triggered on the ordinary path.** `rescue-lib/rescue-required?` is
  true only when the actor placing work in a worktree differs from the role
  that owns it — a role committing its own work in its own worktree must
  trigger nothing.
- **Not a reduction of the wider stash backlog.** Auditing or clearing the
  repo's other stash entries is out of scope for this ticket.

## Source

- `swarmforge/scripts/rescue_lib.bb` — the pure decisions
  (`source-release-allowed?`, `rescue-required?`, `rescue-plan`,
  `notification-draft`).
- `swarmforge/scripts/rescue_orphaned_work.bb` — the CLI; does the git.

Acceptance feature:
`specs/features/BL-1041-a-rescue-never-makes-orphaned-work-less-durable.feature`.
