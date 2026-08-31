# BL-1305 architect review — 2026-08-31

## Inbound

Merged cleaner commit `d62cb774bd` (fast-forward, ancestry trivially
confirmed) into `swarmforge-architect`.

## Dependency-rule gate (BL-259, hard gate)

`cd extension && node out/tools/dependency-gate.js` (full-repo scan, files
straddle `extension/`/`specs/`): **PASSED, no forbidden edges.**

## Co-change tool (BL-255)

Ran against all four touched/added files
(`bl1305FixtureAgentBinarySteps.js`, `roleLifecycleParkUnneededSteps.js`,
`bl1305FixtureAgentBinary.test.js`, `bl1305FixtureAgentBinary.property.test.js`).
All cross-references land at 1 co-change, below the default threshold
(frequency 3). Nothing flagged as suspected coupling.

## Invariants review (Article 4.4 / BL-654)

Ticket declares one invariant after the specifier's 2026-08-31 amendment
(invariant 2 retired as an unbuildable mechanism mandate — see
`backlog/evidence/BL-1305-bounce-20260831.md`):

> "No acceptance step handler ever executes a real agent binary: a
> fixture's agent command runs the fixture's own stub, whatever the pane
> shell's startup files do to PATH."

- Executable property test present and non-vacuous:
  `extension/test/bl1305FixtureAgentBinary.property.test.js`. The
  "reach floor" test explicitly proves the generator reaches states where
  PATH precedence alone would lose (asserts the stub loses with isolation
  removed, then wins with it restored) — not hand-waved.
- Re-ran both property tests myself: 2/2 pass.
- Swept the parcel for other sites that could violate the invariant: the
  only production code path that resolves the agent command inside a pane
  shell is `roleLifecycleParkUnneededSteps.js`'s `mkFakeBin`/`fakeEnv`, and
  the new `bl1305FixtureAgentBinarySteps.js` step handlers exercise it via a
  real tmux pane (not a direct `spawnSync`, which would not exercise the
  defect — the handler's own comment states this and it's correct). No
  other invariant-relevant site found.
- No violation. Nothing to sweep-and-bounce.

## Architecture checks

- Two-layer boundary (view vs. tmux substrate): N/A — this is APS fixture
  code under `specs/pipeline/steps/`, not extension-host/webview
  production code. No TypeScript spawns an agent process to bypass tmux;
  the fixture's use of `tmux`/`spawnSync` is the established pattern every
  sibling step-handler file already uses to simulate the real substrate.
- No webview, no browser storage, no secrets touched.
- Integrate-not-fork: fixture/test code only, does not touch
  `swarmforge/` fork content beyond the doc note in
  `swarmforge/handoff-protocol.md` (unrelated BL-1302 content riding the
  same merge-up chain, not this ticket's own work).
- `required_wiring` confirmed: `bl1305FixtureAgentBinarySteps` registered
  at `specs/pipeline/steps/index.js:169`.

## Re-ran full check suite myself

- Unit: `npx vitest run test/bl1305FixtureAgentBinary.test.js` — 3/3 pass.
- Property: `npx vitest run --config vitest.properties.config.mjs
  bl1305FixtureAgentBinary.property.test.js` — 2/2 pass.
- Gherkin acceptance:
  `node specs/pipeline/cli.js specs/features/BL-1305-fixture-agent-binary-is-the-stub.feature`
  — 3/3 pass.
- Mutation-site-count re-check: both files still `over` the advisory
  threshold (169, 552) — same finding as cleaner's, already reasoned there
  (both are single-feature `registry.define()` collections matching every
  sibling file under `specs/pipeline/steps/`; `roleLifecycleParkUnneededSteps.js`'s
  size predates this ticket). Soft advisory, not acted on — concur with
  cleaner.

## Correctness read

No defect spotted beyond what the coder/specifier already surfaced and
resolved (the spec-gap on invariant 2 / scenario 01, already adjudicated).
The ZDOTDIR-isolation mechanism is sound: fixture-owned `.zshenv` re-wins
PATH ordering deterministically in every nested zsh, verified myself via
the reach-floor property test and the live scenario run.

## Verdict

Clean pass. No architecture violation, no invariant violation, no
correctness defect. Forwarding to hardener.

By architect.
