# BL-1230 architect bounce — 2026-08-28

## Review pass inventory

- **D1 — invariant-unencoded.** The ticket declares two `invariants:`:
  1. "A git repository nested inside the working tree is reported unless git
     itself created it there ... exemption is by construction, never a
     blocklist of known leak paths."
  2. "The check never deletes, moves, or rewrites a nested repository; a
     reported leak is still present after the check runs."

  Neither has an executable property test, and no ticket note states a
  non-encodability reason. `findNestedGitRepositories` (reviewed at
  `extension/test/helpers/nestedGitRepoGuard.js`) already takes an
  injectable `readdir` seam — the exact shape a fast-check property needs to
  generate arbitrary tree layouts (random nesting depth, random placement of
  `.git` directories vs `.git` files vs `node_modules`/`.worktrees` entries)
  without touching the real filesystem or spawning `git`. Both invariants
  are concrete, quantified-over-input properties this module is well suited
  to encode:
  - Property 1: for any generated tree, the reported violation set equals
    exactly the `.git` DIRECTORY paths that are neither the root's own
    `.git` nor under `node_modules`/`.worktrees` — independent of tree shape
    or nesting depth.
  - Property 2: for any generated tree, every path present before the call
    to `findNestedGitRepositories` is still present after (the fake-fs
    approach can assert the input structure is untouched, or a real-fs
    variant can assert nothing under the generated root was removed).

  Only unit examples exist today (`extension/test/nestedGitRepoGuard.test.js`,
  12 hand-picked cases). A missing property test is itself the send-back
  per the Invariants Review section — I did not hand-verify the invariants
  against the example tests as a substitute.

- Dependency-rule gate (`extension/out/tools/dependency-gate.js` against
  `test/helpers/nestedGitRepoGuard.js`, `test/nestedGitRepoGuard.test.js`,
  `test/activePoolFreshnessAudit.test.js`): **PASSED**, no forbidden edges.
- Co-change report (`extension/out/tools/co-change-report.js`, same files
  plus the step handler and `specs/pipeline/steps/index.js`): all pairs
  below the default frequency-3 threshold — no suspected coupling.
- Two-layer boundary / host-owns-I/O / no-webview-storage / integrate-not-fork:
  N/A — this module has no webview or extension-host surface; it is a pure
  fs-walking helper plus its test/step-handler callers.
- Correctness read: no defect found beyond D1. The `walk` function correctly
  skips descending into a reported `.git` directory or into
  `node_modules`/`.worktrees`, and correctly distinguishes a `.git` FILE
  (worktree gitfile) from a `.git` DIRECTORY via `Dirent.isDirectory()`.

## Remediation

Coder: add a `*.property.test.js` for `findNestedGitRepositories` using
fast-check, encoding both declared invariants above against generated tree
structures (via the existing injectable `readdir` seam — no real git spawns
needed for the property runs). Show each property fails when the invariant
is deliberately broken, then restore, per the break-then-fix discipline.
Forward back through cleaner → architect once added.

## Commit reviewed

3c9cdbc65c (cleaner's readdir-seam / BL-1039-exempt cleanup on top of
coder's 09578f339).
