# BL-713 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `d439aaab2` (cleaner) into the architect worktree:
`4fa740c98` (coder, "a Cursor-driven seat holds a real role in the
pipeline") + `d439aaab2` (cleaner, "split cursorSeatDriver.ts to bring
mutation sites within threshold"). Merged cleanly, no conflicts.
`npm run compile` clean before running any tool against `extension/out/`,
per [[architect-stale-build-gotcha]] — `out/swarm/cursor*.js` and
`out/tools/cursor-seat-spike.js` did not exist yet at merge time.

## Scope

Slice A of BL-712 (epic-swarm-intelligence-layer, M8): a Cursor SDK-driven
seat that can hold one pipeline role, take a wake, run `ready_for_next.sh`,
do the stage work over a structured agent session, and forward through
`swarm_handoff.sh` — with `cursor-seat-spike.ts` as its sole live caller
(the ticket's `required_wiring`), an explicit stand-in for the real
launcher integration BL-712 slice B will build. Deliberately runs outside
tmux for this one spike CLI only, guarded by an exact-match
`SWARMFORGE_CURSOR_SEAT_SPIKE=1` escape that refuses on a production pack;
`approval_context` records the human's 2026-07-30 sign-off on exactly this
posture. Six source files (cleaner split `cursorSeatDriver.ts` into
`cursorIdentity.ts` / `cursorSeatProtocol.ts` / `cursorSeatWireFormat.ts` +
orchestration-only `cursorSeatDriver.ts`, plus coder's `cursorSeatSession.ts`
SDK adapter and `cursor-seat-spike.ts` CLI), four test files, one new
feature file (7 scenarios/outline rows) with its step handler registered in
`specs/pipeline/steps/index.js`.

## Architecture

- **Two-layer boundary (Rule 1) — deliberately, narrowly crossed, not
  violated.** This slice's CLI drives a Cursor agent process directly from
  TypeScript, outside tmux — exactly the shape Rule 1 warns about in
  general. It is not an unreviewed alternative to tmux orchestration: the
  ticket's own `description`/`approval_context` name this as a bounded,
  human-approved spike whose falsifiable purpose is to retire the *protocol*
  risk before BL-712 slice B wires `cursor` into the `swarmforge.sh`
  launcher whitelist (the real, tmux-based destination this is a stepping
  stone toward). Guardrails are structural, not just documentary: the spike
  posture gate (`resolvePackPosture`/`admitCursorIdentity`, invariant 3)
  refuses an uncertified identity outside the exact escape value, and
  `cursor-seat-spike.ts` is explicitly out-of-scope for `/pilot` or any
  existing Claude seat. Judged in-policy for this one ticket; would not
  extend this reasoning to a second such CLI without its own approval.
- Extension-host/webview split: not touched. No webview code in this
  parcel, no browser storage, no `postMessage` surface.
- Secrets: `CURSOR_API_KEY` read from `env` inside `createLiveSeatDeps`
  (extension-host-equivalent Node process env), never written to the target
  worktree or a commit — grepped the diff for the literal string, no hit
  outside the one `env.CURSOR_API_KEY?.trim()` read.
- Integrate-not-fork: `swarmforge/` fork untouched by this parcel (all
  changed files are under `extension/` and `specs/pipeline/steps/`).
- Dependency direction: `cursorSeatDriver.ts` (orchestration) depends on
  `cursorIdentity.ts` and `cursorSeatProtocol.ts` (both depend nothing back
  on the driver); `cursorSeatProtocol.ts` re-exports `cursorSeatWireFormat.ts`
  cleanly layered pure-text-under-pure-decision. `cursorSeatSession.ts` (the
  only file that imports `@cursor/sdk` and does real I/O) imports *types
  only* from `cursorSeatDriver.ts`; the driver never imports the session
  adapter — `cursor-seat-spike.ts` is the one place that wires both
  together via `SeatDeps`. High-level policy (`decideNextStep`,
  `admitCursorIdentity`) stays IO-free.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Scoped to the six changed `extension/` files (run from `extension/`, paths
relative — the tool errors on repo-root-relative paths):

    Dependency-rule gate PASSED: no forbidden edges.

Full-repo scan (post-compile) for completeness on a change of this size:

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Confirmed pre-existing and untouched by this parcel (`git log -1` on all
three files predates both BL-713 commits; already tracked as `BL-759`,
paused). Not re-reported per
[[architect-grep-exact-filenames-before-worth-a-ticket-note]].

## Co-change (`node extension/out/tools/co-change-report.js`)

Run against all six changed source files. Every reported pair is exactly 1
co-change (this is the feature's first commit pair) — the cluster is the
expected shape of a deliberate split: `cursorSeatDriver.ts` co-changes with
all four of its siblings plus every consumer (tests, `cursor-seat-spike.ts`,
the step file, `index.js`), since it is the orchestration hub; the three
split-off modules co-change only with each other and the driver, not with
the session/CLI layer. No coupling outside what the module boundaries
already declare. Below the tool's default frequency-3 threshold everywhere;
informational only, no action.

## Invariant review (BL-654/BL-633) — three declared, all real, all verified

`required_wiring` verified live, not just as a comment: `cursor-seat-spike.ts`
imports `runSeatOnce` from `../swarm/cursorSeatDriver` and calls it in
`main()` (`io.run ?? runSeatOnce`) — confirmed by reading the compiled
`main()` body, not by grepping a docstring, per
[[required-wiring-anchor-goes-vacuous-not-absent-on-a-file-split]] (this
parcel IS a file split, so this was the specific trap to check for — the
anchor survived the split).

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | No private side channel: reaches the swarm only via `ready_for_next`/`swarm_handoff` and writes only its own `tmp/handoff.txt` + transcript | `cursorSeatDriver.property.test.js` "invariant 1" (2 properties, 400 runs each, weighted generators so forward/abort/no_task/refused all clear a 20-run floor) + acceptance scenario 03 | Read the full property file; the write-target assertion checks every recorded write against the exact allowed path set, not just "no inbox hit" |
| 2 | Decisions come only from structured `SessionSignal`, never rendered pane text | `cursorSeatDriver.property.test.js` "invariant 2" (purity + a constructed pane-text-collision pair + fc.string() fuzz on unstructured kinds) + acceptance scenario 04, which also great-greps the driver source for `capture-pane`/`tmuxClient`/etc. | Read `decideNextStep` — genuinely takes only `SessionSignal`, no closure over deps/env; confirmed the collision property actually forces overlap by construction (asserted `paneTextOf(tool).includes(paneTextOf(stop))` inside the test itself) |
| 3 | Uncertified identity refused on a production pack; only the exact spike escape admits | `cursorSeatDriver.property.test.js` "invariant 3" (2 properties: admission truth table incl. near-miss escape values, and a refused run touches zero deps) | **Broke it myself and watched it go red, not trusted from the commit message**: changed `admitCursorIdentity`'s certified check to `opts.status === 'certified' || true` (unconditional admit) in `cursorIdentity.ts`, recompiled, reran the property file → 2/7 tests failed exactly as expected (`invariant 3: a refused run opens no session...` — counterexample `["specifier","candidate",undefined]`, correctly caught the missing refusal). Reverted; `git diff` on the file confirmed empty; recompiled and reran → 7/7 green again. |

No missing or vacuous property test for any declared invariant.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

`cursorSeatWireFormat.ts`'s `buildSeatHandoffDraft` and
`parseReadyForNextOutput` are the only touched pure modules not already
exercised by the three invariant properties above. Assessed and judged
adequately covered by the existing example-based unit tests rather than
worth a new property:
- `buildSeatHandoffDraft`'s two validated boundaries (10-hex commit,
  `NN` priority) are already exercised across the input space by
  invariant 1's own property (which draws commits from a `hexCommit`
  arbitrary and asserts the exact draft text shape on every forwarded run)
  plus four explicit boundary-throw unit tests; no round-trip pair exists
  to test — nothing in this parcel parses a handoff draft back.
- `parseReadyForNextOutput` reads only `String.prototype` methods
  (`split`/`find`/`startsWith`/`slice`) with an explicit `no-task` default
  for anything unrecognised — no throw path exists for it to be fuzzed
  against, and its four real branches (`task`/`no_task`/`rotate_home`/
  `draining`) are each pinned by an existing unit test.

Nothing to add.

## Correctness read-through

Read `runSeatOnce`, the session adapter's signal mapping, and the CLI's
`main()` end to end. One thing worth naming and closing rather than
bouncing: `decideNextStep` has a `continue_session` step that
`sendTaskToLiveSession` can never actually hand back to the driver — its
`signal` selection only ever returns a denied `tool_event` or a terminal
`stop_reason` (never a *granted* `tool_event`, which is the only shape that
maps to `continue_session`), so the `if (decision.step !== 'forward_handoff')`
catch-all in `runSeatOnce` treating everything else as `aborted` is
currently correct but relies on that adapter-level filtering rather than an
exhaustive case match at the call site. Not a defect against any declared
invariant or the falsifiable outcome ("one ticket slice goes in as a
handoff and comes out as a handoff") — a mid-run tool grant genuinely has
nothing to abort on. Noted rather than bounced or filed, since fixing it
would mean designing multi-turn session continuation, which the ticket's
own "Out of scope" section defers past this slice.

No other defect found.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean, before running any gate or
  test (`out/` had none of the new modules pre-merge).
- `node out/tools/dependency-gate.js` on the six changed files: PASSED.
- `node out/tools/dependency-gate.js` full-repo: same 3 pre-existing
  BL-759 edges, confirmed above.
- `node out/tools/co-change-report.js` on all six changed files: reviewed
  above, no new coupling.
- `npx vitest run test/cursorSeatDriver.test.js test/cursorSeatSession.test.js test/cursorSeatSpikeCli.test.js`
  → 68/68 pass.
- `npx vitest run --config vitest.properties.config.mjs test/cursorSeatDriver.property.test.js`
  → 7/7 pass; independently broken (invariant 3) and restored, see above.
- `node specs/pipeline/cli.js specs/features/BL-713-cursor-seat-driver-spike.feature`
  → **9/9 pass** (TAP: `# pass 9`, `# fail 0`).

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness
defect that rises to bounce-worthy in this parcel. Forwarding to hardener.

Note, not a bounce: `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
still sits untracked in this worktree, pre-existing and unrelated to
BL-713 — already surfaced and ticketed as BL-724 per
[[stray-mono-router-auto-rotate-test-unticketed]]. Left untouched.

Note, not a bounce: `backlog/paused/BL-713-cursor-seat-driver-spike.yaml`
is a stale duplicate of `backlog/active/BL-713-cursor-seat-driver-spike.yaml`
(older `priority: 122`/`direction: human-requested`/`assigned_to: none`
snapshot, predates the queue-jump promotion) that arrived via the merge
from `main`'s history, not from either BL-713 commit — backlog bookkeeping
hygiene, outside this parcel's scope and outside the architect's routing
authority.

— By architect.
