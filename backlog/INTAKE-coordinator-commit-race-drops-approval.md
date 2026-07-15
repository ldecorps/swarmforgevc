# Intake: coordinator bookkeeping commits on the shared master checkout can silently drop a staged YAML edit (2nd occurrence)

Filed by the coordinator (2026-07-15T12:1x BST). This is a RAW ask, not a spec:
the specifier drains this like any other backlog-root item and decides what (if
anything) becomes a real ticket.

## What happened, this occurrence

While promoting BL-412 (`backlog/paused/` -> `backlog/active/`) after the human
approved it via Telegram reply, the sequence was:

1. `git diff` showed `human_approval: pending -> approved` staged in the working
   tree (the field the human's Telegram "Approved" reply had just flipped).
2. `git mv backlog/paused/BL-412-*.yaml backlog/active/BL-412-*.yaml` then
   `git commit` (`83564b2d`) — no error.
3. `git show 83564b2d:backlog/active/BL-412-*.yaml` afterward showed
   `human_approval: pending` — the approved edit was NOT in the commit that
   claimed to carry it.

Downstream effect: because the committed content read `pending` again, the
front-desk's own pending-approval detection treated it as a fresh
not-approved->pending transition and re-sent the full ticket description to the
human's BL-412 Telegram topic ~24s after the coordinator's commit, and the human
(seeing the earlier wrong "Nothing to approve right now" reply — filed separately
as `INTAKE-approval-reply-wrong-confirmation.md` — plus this confusing re-ask)
asked "Does this need approval?" again. Recovered by re-diffing, re-committing,
and this time verifying with `git show <sha>:<path>` (not just the pre-commit
`git diff`) that the commit actually carried `approved` — it did on the second
attempt (`4fa2417e`).

## Prior occurrence (2026-07-14)

The same shape happened promoting BL-357 and BL-341: `git status --short` showed
`RM` (staged content differs from the pre-rename blob) immediately before commit
`ddcea974`, which nonetheless landed `human_approval: pending` on both files —
confirmed via `git show ddcea974:<path>`, and confirmed NOT a display artifact
because QA's own downstream commit for BL-357 (with `ddcea974` as an ancestor)
also carried `pending`. Recovered the same way: re-edit, re-commit, re-verify
with `git show` (`e77d9f62`).

## Third occurrence, SAME SESSION (12:19 BST) — root cause caught directly, no longer a hypothesis

Committing an unrelated single-file edit (`git add
backlog/INTAKE-approval-reply-wrong-confirmation.md` — one explicit path, no
`-A`, no `-a`) with `git commit -m "..."` produced a commit containing SEVEN
files, not one: the specifier's own concurrently-staged work (BL-416, BL-417,
BL-418 backlog YAMLs + their `.feature` files) rode along, because `git
commit` with no pathspec commits the WHOLE INDEX, not just what the caller
just `git add`ed. `git status` immediately after was clean — the specifier's
work had already been fully staged (all 6 files) at the moment this process's
`git commit` ran, so nothing was lost, but it landed under this process's
unrelated commit message and SHA, and the specifier's own commit (if it was
about to make one) would find nothing left to commit.

This directly confirms the mechanism guessed at below: two roles
(coordinator, specifier — both `worktree master` per `swarmforge.conf`,
literally the same checkout and the same `.git/index`) run `git add` /
`git commit` concurrently with no coordination, so whichever one commits
next captures whatever the OTHER has staged at that instant — sometimes
that means the committer's own edit goes missing from ITS commit (if a
third party's commit lands between this process's `add` and `commit`,
clearing the index of this process's own staged change along with it —
occurrences 1 and 2 above), sometimes it means someone else's staged work
gets swept into the wrong commit (this occurrence). Same root cause,
two visible symptoms.

## Why this matters / suspected shape

Both occurrences are on `main`, the coordinator's own live worktree, which
(per `swarmforge/PIPELINE.md`) is shared with no isolation from other processes
that touch the same checkout — including whatever writes `backlog/topics/*.json`
("BL topic record for ..." commits, which land at very high frequency, up to
~8/min has been observed) and whatever fast-forwards local `main` when QA pushes.
A multi-second window between staging an edit (`git add`/`git mv`) and running
`git commit` on a checkout under that much concurrent write pressure looks like
a plausible race — e.g. another process running `git add -A` / `git commit`
of its own in the same working tree between this process's stage and commit
steps, capturing/committing a different tree than the one just staged. This is
a hypothesis based on two occurrences of the same symptom, not a diagnosis; no
mechanism has actually been caught in the act. It has now recurred, per the
guidance from the first occurrence, so it is filed here rather than silently
worked around a second time.

## Scope note

This ticket is about the SHARED-CHECKOUT COMMIT RACE possibly dropping staged
content. It is not about the wrong-confirmation-message bug (filed separately)
or about the front-desk's own re-ask-on-pending-transition behavior (which
appears to be working as designed, just triggered by this race's bad commit).

## Suggested acceptance shape (for the specifier to refine or reject)

Whatever the mechanism turns out to be, the fix should make `git show
<new-sha>:<path>` reliably match the caller's own last-staged content for
that path — either by identifying and serializing the concurrent writer(s)
against the coordinator's stage-then-commit window, or by having every
writer to this shared checkout re-verify its own commit against what it
staged (the same `git show`-after-commit discipline this ticket's evidence
used to catch it) and retry-once on mismatch before treating a commit as
successful.
