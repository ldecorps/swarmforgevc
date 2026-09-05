# BL-1364 hardener follow-up — fixture leak fix, still forwarding

## What changed
Responding to a priority-50 note from cleaner: "BL-1364: fixture uses
mkTmpDir not mkProcessTmpDir, leaks under acceptance".

`specs/pipeline/steps/bl1364MechanicalShareReadableSteps.js` imported and
called `mkTmpDir` for its scratch root. `mkTmpDir`'s cleanup fires on a
Vitest `afterEach` (registered by `vitest.config.mjs`'s setupFiles), but
this step file runs under `specs/pipeline/runtime.js`'s plain
`node --test` acceptance runner, which never loads that Vitest setup file
— so every acceptance run of this feature leaked its `aps-bl1364-*`
scratch directory into `os.tmpdir()`.

Fixed by switching to `mkProcessTmpDir` (same helper module, cleans up via
`process.once('exit')` instead — the correct choice for a fixture used
outside Vitest, per that helper's own header comment).

## Verified
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1364-...feature` — **8/8** pass, unchanged.
- `ls /tmp | grep '^aps-bl1364-'` — empty before AND after the run
  (previously would have left one directory per run).
- Unit/property suites re-run unaffected (this file is acceptance-only,
  not required by any Vitest test): 33/33, 4/4.

## Broader pattern, surfaced not fixed
Grepped the same shape across every step handler:
`grep -l "mkTmpDir\b" specs/pipeline/steps/*.js | xargs grep -L
"mkProcessTmpDir"` — **17 other files** share the identical defect (import
`mkTmpDir`, no `mkProcessTmpDir`, run under acceptance). No existing
ticket covers this class (grepped `backlog/` for the pattern, no hits).
Not this ticket's files, not touched by this diff, and 17 files is too
large a fix to fold into a hardening pass for one unrelated ticket — sent
a priority-`00` spec-gap note to the specifier naming the count and citing
this ticket, rather than fixing 16 other tickets' files silently or
leaving the class undiscovered.

## Forwarding
Still forwarding to documenter, same task name, this new commit.
