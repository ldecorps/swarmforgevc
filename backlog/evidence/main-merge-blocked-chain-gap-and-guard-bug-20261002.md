# main merge-blocked: chain-gap + merge-drop guard bug (coordinator, 2026-10-02)

Asked to specifier per operator escalation (notes 015260-015265 range) and
operator's two NOTE-main-mid-merge-*.md files. Current state: clean, stable,
`nothing to commit, working tree clean`, main 26 ahead / 11 behind origin/main,
no stray MERGE_HEAD. Not retrying further without adjudication.

## Problem 1: the lander's land-approval chain-gap blocks legitimate merges

`swarmforge/scripts/check_pipeline_code_on_main.sh`'s QA-exclusive-path guard
has a built-in exemption (`pipeline_path_import_exempt`) for a merge that only
brings in already-QA-approved content: it walks each offending path back to
its own last-touching commit on the incoming side and asks
`is_qa_ancestor.sh`. This exemption fails for every lander land this session
tested (confirmed by direct test, not assumption, on two separate merge
attempts: source `71c6ef1e99` then `942dddee74`):

```
$ bash swarmforge/scripts/is_qa_ancestor.sh 942dddee74
not approved: 942dddee74 has a land-replay record naming source 139c277959,
which is not itself approved
$ bash swarmforge/scripts/is_qa_ancestor.sh 974b1c35e7   # per-path anchor for extension/src/quality/nightClosingCeremonyLive.ts
not approved: 974b1c35e7 has a land-replay record naming source 6e7fe3d4cb,
which is not itself approved
```

Every one of these "source" commits (`139c277959`, `6e7fe3d4cb`, `4511911ac9`,
`6e7fe3d4cb`, etc.) IS a genuine QA review-pass commit I personally traced and
resumed earlier this shift (the "stranded QA review on an abandoned BL-1871
parcel line" pattern — BL-1836, BL-1868, BL-1876, BL-1877, BL-1890, BL-1892,
BL-1898 all hit it). The lander's own land-approval record only names the
IMMEDIATE commit it republished from, never walking back to the original
approved QA review when a rematch/resume happened in between. So
`is_qa_ancestor.sh`'s chain lookup dead-ends on an unrecorded intermediate,
and the guard's otherwise-correct exemption can never fire for ANY lander
land whose history includes one of these resumes — which by now is most of
them.

**Effect:** `git merge origin/main` on the master checkout resolves with zero
conflicts every time, but `git commit`/`git merge --no-edit` is refused by
the pre-merge-commit hook, because the exemption can't verify approval.
Neither `--no-verify` nor `SWARMFORGE_ROLE=QA` impersonation is something the
coordinator may use (Article 1.8/4.2/BL-247).

**This is the same gap class BL-1898 ("a landed ticket's land record
satisfies the close guard") already exists to close** — it's queued for the
lander now. Whether BL-1898's fix also closes this merge-commit-side gap, or
needs a sibling ticket for `check_pipeline_code_on_main.sh`'s own exemption
walk, is a specifier call.

## Problem 2: a separate merge-drop guard false-triggers AND corrupts its own cleanup

After aborting the blocked merge and committing safe, pipeline-code-free
backlog bookkeeping (filing the operator's intake, closing BL-1859), the SAME
`commit_integrity_cli.bb` call was refused by a different guard:

```
Error: merge deletes 'backlog/evidence/BL-1836-QA-20261002.md' (BL-1836,
introduced at 974b1c35e7 on the incoming branch), not named in the commit
message.
[... 17 more paths ...]
Commit rejected: name the affected ticket id(s) in the commit message to
confirm a deliberate removal, or re-merge the branch commit(s) that
introduced these paths first.
— INDEX LEFT DIRTY: restoring the caller's paths to their pre-call state also
failed
```

This fired on a commit that only touched `backlog/active/BL-1859-*.yaml` and
`backlog/done/M8/BL-1859-*.yaml` — nothing under the 18 flagged paths. The
guard appears to compare the resulting tree against `origin/main`'s current
tip rather than against the commit's own parent, so ANY commit made while
the branch is legitimately behind (not yet having merged in BL-1836/1868/
1877/1890's evidence files) reads as "this commit deletes them" even though
it never touched them and they were never present on this branch's own
history to begin with.

Worse: on rejection, the tool's own cleanup failed ("INDEX LEFT DIRTY") and a
**fresh `MERGE_HEAD` reappeared** in the working tree afterward, requiring a
second `git merge --abort` to reach a clean state again. This looks like the
guard's drop-detection runs its comparison via an actual `git merge
origin/main --no-commit` internally (to compute the incoming tree) and
doesn't always clean that up on the error path.

This is very likely the exact behavior the operator's note flagged as worth
checking ("a clean exit-0 merge has silently dropped a pure addition here
before") — except here it over-fired on an UNRELATED commit, and the
tool-side bug (dirty index + resurrected MERGE_HEAD) is new information not
in the operator's original note.

## What is needed

1. A ruling on BL-1898's scope: does it cover `check_pipeline_code_on_main.sh`'s
   exemption walk too, or does that need its own ticket?
2. A look at the merge-drop guard inside `commit_integrity_cli.bb`'s path (name
   TBD by whoever owns it) for the false-trigger-on-unrelated-commit behavior
   and the dirty-index-on-rejection bug.
3. Until either lands, master's `main` cannot safely absorb `origin/main` nor
   commit ordinary backlog bookkeeping while behind by lander-only commits.
   BL-1859's close and several evidence-import paths are stuck as a result.

Current state is clean and stable (verified). Not retrying further without
a decision.
