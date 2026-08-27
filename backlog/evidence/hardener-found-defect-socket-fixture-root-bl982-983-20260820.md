# Found while hardening BL-995: standing socket-fixture-root guard is RED on main

Not caused by BL-995's parcel and not fixed here — surfacing per the
"complete review inventory" discipline (a review pass records what it
finds, even outside its own ticket's scope) and the standing-guard rule
(hardener.prompt, 2026-08-19 accepted rule_proposal: any parcel touching
`specs/pipeline/steps/` must run every `test/*Guard*.test.js` before
forwarding).

## What was run

```
cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')
```

Because BL-995's parcel added `specs/pipeline/steps/bl995DetachedJobSteps.js`
and edited `specs/pipeline/steps/index.js`.

## What failed

`test/socketFixtureShortRootGuard.test.js` > "the real specs/pipeline/steps
tree has zero socket-fixture long-base violations":

```
specs/pipeline/steps/bl982SecondSeatSteps.js: builds or references a control
  socket but roots its fixture at os.tmpdir() (long on macOS; the socket
  path overruns swarm_socket_lib.bb's 100-char guard) - use
  lib/socketFixtureRoot.js's mkSocketFixtureRoot instead
specs/pipeline/steps/bl983StageQueueSteps.js: same
```

`bl995DetachedJobSteps.js` (this ticket's own new file) is clean - it is
not in the violation list.

## Why this is not BL-995's to fix

- `git log --oneline main -1 -- specs/pipeline/steps/bl982SecondSeatSteps.js`
  → `966f6b3ea` (BL-982, already on `main`).
- `git log --oneline main -1 -- specs/pipeline/steps/bl983StageQueueSteps.js`
  → `0817e9ef1` (BL-983, already on `main`).
- Both predate BL-995 entirely; BL-995's diff touches neither file.
- The guard itself (`socketFixtureShortRootGuard.test.js`,
  `lib/socketFixtureRootGuard.js`) landed via BL-948 (`77c887dc5`,
  `f75a758db`) - on main before BL-982/983 landed. Whatever hardening pass
  cleared BL-982/983 for QA did not run this guard, or ran it before these
  two files existed in their current form.

## Concretely

`bl982SecondSeatSteps.js:54` and `:103` root acceptance fixtures at
`os.mkdtempSync(path.join(os.tmpdir(), ...))`, and `:249` writes
`.swarmforge/tmux-socket` under that root - the exact
long-base-plus-socket combination BL-948 exists to prevent (the resulting
socket path can overrun the 100-char AF_UNIX limit on macOS).
`bl983StageQueueSteps.js` shares the shape (not itemized here; same guard
output).

## Action needed

A `type: defect` ticket against `bl982SecondSeatSteps.js` and
`bl983StageQueueSteps.js`: migrate their socket-building fixtures to
`lib/socketFixtureRoot.js`'s `mkSocketFixtureRoot`, same as BL-948's own
49-file sweep did for the rest of the tree. Left for the specifier to mint;
not folded into BL-995 (out of scope, unrelated files, per Article 4.3 -
a bounce routes to the role that owns the fix, and this predates any
ticket currently in flight through this hardening pass).
