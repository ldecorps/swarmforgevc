# BL-1330 content silently dropped by human merge b71c941a19 — 2026-09-02

## Report
Coder note (priority 00) to coordinator: "main merge b71c941a19 silently
dropped BL-1330 landed files - restore".

## Verification
`b71c941a19` is a merge commit, parents `0132715d1e` (local main tip after
BL-1334 close) and `0a5bffe057` (BL-1330's QA-landed commit, also
`origin/main`'s tip at the time). Per the guardrail "diff every merge
against BOTH parents":

- `git diff 0132715d1e b71c941a19 --stat` — only BL-1339 mint files added
  (2 files, 318 insertions). None of BL-1330's content appears.
- `git diff 0a5bffe057 b71c941a19 --stat` — shows large deletions:
  6 `backlog/evidence/BL-1330-*.md` files,
  `specs/pipeline/steps/bl1330SwarmStampBobAnthropicStartingCastSteps.js`,
  `specs/pipeline/steps/lib/bl1330QwenRemapPredicateCli.zsh`, and the
  `specs/pipeline/steps/index.js` registration entry — all present on
  `0a5bffe057`/`origin/main` but absent from the merge result.

Confirmed on current `HEAD` (`3cd85a5250`, after my own subsequent
bookkeeping commits): all of the above paths are genuinely missing —
`git cat-file -e HEAD:<path>` fails for each. This is a real content loss,
not a false alarm. `origin/main` still has the correct content
(`origin/main` == `0a5bffe057` at time of check) — only local `main`'s
history lost it via the merge commit `b71c941a19`, which was authored by
the human directly (`Author: t <t@t>`), not by me or by handoffd's
reconcile sweep. This is the same commit whose in-progress `MERGE_HEAD`
state I reported and stood down on in my previous turn's evidence file
(`coordinator-main-sync-dirty-merge-head-stall-bl1330-20260902.md`) — the
human completed it by hand between my turns, and the completion dropped
the content.

## What I did NOT do
I attempted a mechanical recovery (`git cherry-pick -n 0a5bffe057`, staged
cleanly, matches `origin/main`'s content) but the `check_pipeline_code_on_main.sh`
pre-commit guard correctly REFUSED it:

> Commit refused: staged change touches pipeline code on `main`... Pipeline
> code (extension/src/ extension/test/ specs/pipeline/steps/) may only land
> on main via QA (Article 1.8/4.2, BL-247).

This is working as designed — I am not QA and must not land pipeline code
on `main` myself, even to restore already-approved content. I unstaged and
reverted the attempt (`git reset HEAD -- <paths>`, `git checkout --
specs/pipeline/steps/index.js`); the untracked recovery files
(`backlog/evidence/BL-1330-*.md`, the two new `specs/pipeline/steps/*`
files) are left on disk as untracked — harmless, byte-identical to
`origin/main`'s content, safe for QA's land step to pick up or overwrite.

## Routing
Sent `note` (priority 00) to QA: "BL-1330 content dropped by human merge
b71c941a19 on main - restore". QA is the integration owner (Article 1.8) —
only QA can land this back onto `main`. Not routing through the full
pipeline (coder→cleaner→...) since this content is already fully vetted
and QA-approved; it needs re-landing, not re-development.

## Open concern for the human
`b71c941a19` was authored directly by a human (`t <t@t>`), not by the
swarm's own reconcile daemon or by me. Worth confirming with the operator
whether this was an intentional manual conflict resolution that picked the
wrong side, or an accidental `git commit` during an aborted merge attempt —
either way, direct human commits on the shared `main` checkout are a
recurring source of exactly this class of silent-drop incident (see
[[merge-reconcile-silent-drop-incidents]]).
