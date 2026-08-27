# Hardener branch (swarmforge-hardender) corrupted — 2026-08-27

Babysitter health sweep escalated: hardender pane blocked on its own
interactive menu ("Corruption fix"), asking for a go-ahead before rewriting
branch history.

## Verified (read-only, `--git-dir`/`--work-tree` explicit — my shell's
`GIT_DIR`/`GIT_WORK_TREE` were set to the main checkout and silently
redirect any `git -C <other-worktree>` command onto main; had to override
explicitly to inspect the hardener worktree correctly)
- Branch `swarmforge-hardender` HEAD = `cea14202e` ("init").
- ~44 junk commits (`init`/`seed`/`fixture: initial`/one literally named
  `BUG: bare commit bypassing commit_integrity_cli`) sit on top of the last
  real commit `da8ef009a` ("merge_and_process architect c5e8ffb3b9 for
  BL-1184. By hardender.").
- Working tree at that corrupted tip reads almost the entire real repo
  (android/, api/, backlog/, docs/, extension/, scripts/, swarmforge/, etc.)
  as **untracked**, plus `src/thing.ts` shows deleted and
  `swarmforge/swarmforge.conf` modified — consistent with the junk commits
  being a near-empty fixture-repo snapshot landing on the real branch, not
  edits to real content.
- Likely cause (unconfirmed): a test harness that creates throwaway
  git fixture repos leaked `GIT_DIR`/`GIT_WORK_TREE` (or ran without an
  explicit `-C`/`--git-dir`) and its `git init`/seed/commit calls landed for
  real on `swarmforge-hardender` instead of its own temp repo — same failure
  shape I just caught live in my own shell env. Worth a ticket on its own
  once the human answers: audit test fixtures for unset `GIT_DIR`/
  `GIT_WORK_TREE` before any `git init` inside a temp dir.

## Hardener's own menu (verbatim options)
1. Reset branch to `da8ef009a` (its recommendation) — mixed reset, moves
   HEAD/branch pointer only, working-directory files untouched, all 44 junk
   commits stay recoverable via reflog. Then it inspects what's actually
   uncommitted and resumes the BL-1184 hardening pass.
2. Investigate further, don't touch git state yet.
3. Stop entirely, flag, leave git state as-is.

## Action taken
This is a hard-to-reverse-looking git operation (branch history rewrite) on
another role's branch — outside coordinator authority to pick for it
(constitution: coordinator does not perform cleanup; also matches
[[nudged-agent-can-block-on-interactive-menu]]: never auto-pick a blocked
role's menu). Filed via `role_ask.bb --role coordinator` with the same
3 options, hardener's recommendation flagged as such, asking the human to
choose. **Awaiting human answer** — do not act further on the hardener menu
until it comes back. On answer: relay into the `swarmforge-hardender:0`
tmux pane (socket `.swarmforge/tmux/1523266553.sock`), re-validating the
menu is still showing the same options before sending keys (menu could have
timed out/changed).
