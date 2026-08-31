# BL-1305 hardener pass — 2026-08-31

## Inbound

Merged architect commit `745cf0f01d` (fast-forward onto `swarmforge-hardender`).

## Whole-tree guards (this parcel touches `specs/pipeline/steps/` and `extension/test/`)

Ran every `test/*Guard*.test.js` (excluding `.property.` siblings), 18 files:

- **Real hit, this parcel's own defect**: `tmuxReaperGuard.test.js` flagged
  `bl1305FixtureAgentBinarySteps.js` — it starts a real tmux server
  (`runInPane`) but never required `./lib/fixtureReaper` or called `track()`.
  Confirmed by hand that scenarios 01 and 02 (unlike 03, which explicitly
  calls `killPaneServers` before its own assertion) had NO teardown at all —
  each opened a real tmux server on an isolated socket and left it running
  for the rest of the process, self-healing only via the stub's 300s bound.
- Fixed in `bl1305FixtureAgentBinarySteps.js`:
  - Wrote the `<root>/.swarmforge/tmux-socket` pointer file (the ONLY way
    `fixtureReaper.reap()` finds a fixture's tmux server — accepted
    rule_proposal 2026-08-22, BL-1049) immediately after creating the
    fixture root, before any tmux `new-session` call.
  - Called `fixtureReaper.track(ctx.root)` and pushed the root onto a
    module-level list.
  - Added a `node:test` `afterEach` that reaps + removes every tracked root
    after every scenario (bl1049's own pattern) — this is the only teardown
    scenarios 01/02 get; scenario 03's inline `killPaneServers` stays as-is,
    since its own assertion needs the servers dead before it runs, not just
    at afterEach.
- Verified the fix closes the leak, not just the guard: ran the feature
  through `specs/pipeline/cli.js` directly, checked `pgrep -af '[t]mux -S'`
  before and after — only the live swarm's own tmux server remains, zero
  fixture sockets, zero leftover `/tmp/aps-bl1305-*` or
  `/tmp/aps-role-lifecycle-fakebin-*` directories. Re-ran twice.
- Re-ran `tmuxReaperGuard.test.js`: 15/15 pass, clean.
- The other 3 guard failures (`liveRepoDerivationGuard`,
  `socketFixtureShortRootGuard`, `tempDirTrapGuard`) are pre-existing and
  unrelated — none name a file this parcel touches
  (`bl1243PaneActivitySignal.test.js`, `bl1112StandingUnitRedsSteps.js`,
  and several `swarmforge/scripts/test/*_lib_test_runner.bb` /
  `test_shell_test_discovery.sh` files). Already ticketed:
  `backlog/paused/BL-1289-a-temp-root-is-always-cleaned-up.yaml`,
  `BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind.yaml`,
  `BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`. Not re-reported,
  not this parcel's to fix.

## Hand-authored mutation sweep (BL-638 fallback)

No wired mutation tool covers this code: Stryker's `--mutate` is scoped to
compiled `out/**/*.js` (extension production TS), and every changed file
here is under `specs/pipeline/steps/` or `extension/test/` — none under
`extension/src/`. Hand-mutated the two load-bearing lines of the new
ZDOTDIR mechanism in `roleLifecycleParkUnneededSteps.js`, ran the property
test (`bl1305FixtureAgentBinary.property.test.js`) foreground each time (no
detached job outstanding), restored immediately after, confirmed restore
byte-identical via `diff`:

1. **`.zshenv` prepend → append** (`export PATH="${PATH:+$PATH:}"'<dir>'`
   instead of prepending `<dir>`): property test failed both assertions —
   `invariant 1` and the reach-floor's final "with isolation" check — the
   resolved binary became the planted rival, not the stub. **Killed.**
2. **Remove `ZDOTDIR: fakeBin` from `fakeEnv()`**: reach-floor's final
   assertion failed — resolved to the REAL host `claude` binary at
   `/home/carillon/.local/bin/claude`, exactly the production defect this
   ticket exists to prevent. **Killed.**

Both mutants are the two things invariant 1 exists to pin; the architect's
own review already established the reach-floor test proves the generator's
states are real (not vacuous), so this sweep targeted the mechanism rather
than re-deriving that. No survivors.

## CRAP / DRY

- CRAP: N/A — no `extension/src/*.ts` file changed by this parcel (CRAP
  scopes to extension production source; this ticket is entirely fixture/
  test code, the shared testability boundary's exempt surface).
- DRY (`jscpd`, `--min-lines 10 --min-tokens 50`) over the four
  new/changed JS files: 0 clones, 0% duplication.

## Full re-verification (post-fix)

- `npm run compile`: clean.
- `npx vitest run test/bl1305FixtureAgentBinary.test.js`: 3/3 pass.
- `npx vitest run --config vitest.properties.config.mjs
  bl1305FixtureAgentBinary.property.test.js`: 2/2 pass.
- `node specs/pipeline/cli.js
  specs/features/BL-1305-fixture-agent-binary-is-the-stub.feature`: 3/3
  pass, run twice, zero real agent processes and zero leaked tmux servers
  both times.
- All 18 `test/*Guard*.test.js` files: 171/174 pass, 3 pre-existing
  unrelated failures (BL-1289/1290/1291, see above).
- No orphaned `node --test`/`stryker`/tmux processes left behind
  (`pgrep -fl` scoped checks clean before handoff).

## Verdict

One real defect found and fixed (tmux-reaper adoption gap on the new step
file, scenarios 01/02 leaked a real tmux server per run). Mutation sweep of
the ticket's own mechanism: 2/2 hand-authored mutants killed, no survivors.
No CRAP/DRY regressions. Forwarding to documenter.

By hardender.
