# BL-1309 — LAND_ESCALATE, 20260903

QA-approved commit `522584ed85` (`BL-1309-qa-approval-20260903.md`) could
not land.

## `land_step_cli.bb`

`bb swarmforge/scripts/land_step_cli.bb
BL-1309-the-mandatory-land-step-never-asks-what-the-tip-carries
522584ed85 .` returned `LAND_ESCALATE`:

    land-step: refusing to replay BL-1309 -
    backlog/active/BL-1296-bubble-answers-from-its-own-seat.yaml is shared
    with unlanded sibling(s) BL-1296,BL-1328, and a replayed path is taken
    whole, so landing it would carry the sibling's lines into main
    (BL-1332)

## Root cause: my own merge commit's subject over-scoped attribution

The commit immediately below this tip, `5d4486eb08`, is `git merge main`
(to pick up BL-1309's `human_approval` restore) and its subject names
"BL-1309" — but the merge, being a sync of `main`, also carries OTHER
tickets' unlanded bookkeeping content: a `bounce_history` addition to
`backlog/active/BL-1296-…yaml` and an `abandoned_commits` line plus a
land-success evidence file for `backlog/done/M8/BL-1328-…yaml`
(`git diff origin/main HEAD -- <those paths>` confirms both are real,
present, and belong to BL-1296/BL-1328, not BL-1309). Because the merge
commit's own message names BL-1309, the attribution walk swept those
unrelated files into BL-1309's "own paths," and the whole-file replay
then refuses to drop lines it does not know are not BL-1309's — the exact
"cross-ticket edit needs an untagged commit subject" shape this session's
own standing practice already names for the documenter role.

This is not a defect in BL-1309's shipped code (technical review passed
twice; see `BL-1309-qa-approval-20260903.md`) and not a genuine content
dependency the way BL-1296/BL-1309 were real blockers for BL-1356 earlier
today — it's a scoping artifact from my own commit message.

## What I did not do

Did not rewrite/reword the merge commit via an interactive rebase (out of
policy) or hand-roll a replacement replay — `land_step_cli.bb` is the
prescribed tool for exactly this and a hand-built substitute would not
agree with the sibling gates by construction, per QA's own role prompt.

## Bounded rematch

`git fetch origin main` immediately before this attempt: no new commits.
Not a race — the escalate is structural (my commit's scope), not
timing.

## Disposition

Not a bounce — nothing in BL-1309's own domain failed; the code and the
ruling are both verified. QA approval **stands**. Escalating to the
specifier per BL-1241 remedy step 3: naming the two swept-in files and
the cause (a merge-commit subject that named one ticket while carrying
several). The specifier or a future land attempt on this branch can
retry `land_step_cli.bb` once BL-1296/BL-1328's own bookkeeping content is
otherwise landed (BL-1328 already has independent `land-success` evidence
in this worktree; only its ticket-YAML lines are the residual gap), or
once a corrected commit boundary separates the sync merge from BL-1309's
own approval record.

By QA.
