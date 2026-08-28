# BL-1196 cleaner pass — 2026-08-28

Merged coder handoff `4faabe5792` for BL-1196 (strip ambient
GIT_DIR/GIT_WORK_TREE before every test file runs — the exact class
recorded in this session's own operator memory: "Ambient GIT_DIR/GIT_WORK_TREE
hijacks worktree git — commits to shared main; unset both first"). Clean
merge, no conflicts. Ticket was correctly relocated from `backlog/done/`
to `backlog/active/` by the coder (found misplaced with `status: todo`,
never actually implemented).

## Review
`gitEnvGuard.js`/`gitEnvGuardSetup.js` follows the exact same
pure/impure split already established by `envRestoreGuard.js`/
`envRestoreGuardSetup.js`, registered in both vitest configs' `setupFiles`
so every current and future test file's local `git()` helper is protected
by construction — nothing to migrate, nothing to remember per file.
Minimal, well-scoped, no duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run gitEnvGuard`: 4/4 pass.
- Acceptance (`BL-1196-test-git-fixtures-must-not-inherit-ambient-git-dir-redirect.feature`
  via `run_acceptance.sh`): 2/2 pass.
- `vitest run sampleResourcesCli` (the one file that manages
  GIT_DIR/GIT_WORK_TREE itself mid-test): 9/9 pass, confirmed unaffected.

By cleaner.
