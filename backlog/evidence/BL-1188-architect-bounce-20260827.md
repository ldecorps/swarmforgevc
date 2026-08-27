# BL-1188 architect bounce — 2026-08-27

## Reviewed commit

`6c544b94e` (cleaner tip forwarded to architect), containing coder's
`daa10afce` ("fix(BL-1188): pipeline STATUS GRID uses live stage report, not
stale cache") plus `e6d2cb13a` (cleaner dedupe refactor) and
`6c544b94e` (cleaner evidence-only commit). Merged into architect at
`b51f5156f`.

## Passed checks

- `node extension/out/tools/dependency-gate.js` (scoped to
  `extension/src/bridge/pipelineGridLive.ts`) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — coupling signal matches
  the diff's own footprint (`bridgeServer.ts`, `pipelineBoard.ts`,
  `consoleMenuUiHtml.ts`, related pipeline-board tests); nothing unexpected.
- Two-layer boundary / host-owns-I/O: `readLiveRoleHeldTickets` shells
  `pipeline_stage_cli.bb` from `extension/src/bridge/` (host side, not the
  webview); no webview storage, no secrets touched.
- `required_wiring` both entries verified present:
  `pipelineGridLive.ts::readLiveRoleHeldTickets` exists and is exported;
  `specs/pipeline/steps/index.js::bl1188PipelineGridLiveStageParitySteps`
  registered (line 816).
- Both declared `invariants:` are property-encoded in
  `extension/test/bl1188PipelineGridLiveStageParityInvariants.property.test.js`
  and verified NON-VACUOUS by hand (after a stale-build false alarm — see
  Notes): invariant 1 has its own explicit non-vacuity test (cache-only
  simulation diverges from the fix); invariant 2 had none written, so I
  broke `resolveRoleHeld` myself (forced cache-only), confirmed the property
  correctly fails, then restored the real build and confirmed all 3 tests
  pass again.
- Acceptance run for `specs/features/BL-1188-pipeline-grid-live-stage-parity.feature`
  is BLOCKED BY a pre-existing, already-documented, out-of-parcel defect —
  `specs/pipeline/steps/index.js` requires
  `./bl592SpecTreeOnLiveConsoleWithEpicTierSteps`, which is absent from this
  worktree's tree (confirmed via `git cat-file -e HEAD:...` — missing, even
  though its adding commit `e5cf2a3af` is a real ancestor of HEAD). This
  matches the branch-corruption chain already evidenced this session in
  `backlog/evidence/BL-592-architect-worktree-anomaly-20260827.md` (same-day,
  same architect worktree, "HEAD tree collapsed to 3 paths" / bounce-revert
  blocked) — not a defect introduced by BL-1188's own diff (the `require`
  line predates BL-1188's commits; confirmed via `git log -p` on
  `specs/pipeline/steps/index.js`). Not re-reporting: already flagged to
  specifier+coordinator via `note` by the prior architect pass. Recorded
  here as BLOCKED, not pass/fail, per Article 4.4.

## D1 — `extension/test/pipelineGridLive.test.js` never runs: missing `node:test` import

**File:** `extension/test/pipelineGridLive.test.js`
**Class:** behavior (test-coverage-nullifying correctness defect)
**Blamed role:** coder (author, commit `daa10afce`)

The file calls bare `test(...)` six times but never imports it — unlike its
own sibling in the same commit family
(`extension/test/telegramCursorBridgePilot.test.js:1`,
`const { test } = require('node:test');`). Running it directly:

```
$ node --test test/pipelineGridLive.test.js
ReferenceError: test is not defined
    at Object.<anonymous> (.../test/pipelineGridLive.test.js:66:1)
```

Every one of the file's 6 tests — including the two that exercise
`readLiveRoleHeldTickets`'s loud-failure contract (BL-814: never a silent
empty map) — throws at load time and never executes. The parcel reads as
unit-tested (a 152-line test file with 6 named cases) but ships zero actual
verification for this file's claims.

**Remediation:** add `const { test } = require('node:test');` as the file's
first line (or fold `test` into the existing destructure), matching every
sibling `*.test.js` in this ticket family. Re-run `node --test
test/pipelineGridLive.test.js` and confirm 6/6 pass before re-forwarding.

## D2 — leaked `mkdtempSync` fixture directory in the acceptance step file

**File:** `specs/pipeline/steps/bl1188PipelineGridLiveStageParitySteps.js`
**Class:** behavior (resource-hygiene correctness defect, BL-971)
**Blamed role:** coder (author, commit `daa10afce`)

`ensureFixture(ctx)` (line ~43) creates `ctx.gridRoot` via
`fs.mkdtempSync(path.join(os.tmpdir(), 'bl1188-aps-'))` and copies the
`pipeline_stage_cli.bb` script closure into it. Nothing in this 281-line
file ever removes `ctx.gridRoot` — no `afterEach`, no `registry.after`, no
`finally`. Grepped for all three: zero matches. Every scenario run leaks a
`/tmp/bl1188-aps-*` directory.

This is the identical defect class I bounced on the sibling ticket BL-592
in this same session
(`backlog/evidence/BL-592-architect-bounce-20260827.md`, D1) — same
engineering.prompt rule (BL-971: *"A fixture dir from `fs.mkdtempSync` is
removed in a `finally`, never only after the last assertion"*), same
established correct idiom already in this directory to copy:
`specs/pipeline/steps/bl1048DeliveredParcelIsNotNotStartedSteps.js`'s
`cleanupFixture(ctx)` wired via `require('node:test').afterEach`. Unlike
`extension/test/pipelineGridLive.test.js` (which correctly used the shared,
self-cleaning `mkTmpDir` helper from `./helpers/tmpDir`), this acceptance
step file bypassed that convention and hand-rolled `mkdtempSync` with no
teardown — the exact anti-pattern BL-420's shared helper exists to replace,
in a file where that helper isn't even wired up (APS/node:test runner, not
vitest).

**Remediation:** add a `require('node:test').afterEach` (or
`registry.after`, whichever this registry's convention prefers — check
`bl1048DeliveredParcelIsNotNotStartedSteps.js` for the established shape)
that unconditionally `fs.rmSync(ctx.gridRoot, { recursive: true, force:
true })` if `ctx.gridRoot` is set.

## D3 — declared acceptance feature file was never actually committed

**File:** `specs/features/BL-1188-pipeline-grid-live-stage-parity.feature`
**Class:** behavior (acceptance-pointer defect)
**Blamed role:** coder

The ticket YAML declares `acceptance:
specs/features/BL-1188-pipeline-grid-live-stage-parity.feature`. The file
exists on disk in this worktree, but it is **untracked** (`git status`
shows `??`) and is not part of any of the three BL-1188 commits
(`daa10afce`, `e6d2cb13a`, `6c544b94e`) or their merge — confirmed via
`git show <commit> --stat | grep .feature` on each, all empty, and via
`git log --all --oneline -- specs/features/BL-1188-...feature`, which only
turns up `seed`/`seed fixture`/`init` canary commits (the same
corruption-canary shape documented in
`backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md` and
the hardener/cleaner branch-corruption evidence this session). Caught
mechanically by `swarm_handoff.sh`'s own `PRE_QA_GATE_FAIL
acceptance-pointer` check when I attempted to send this bounce — it
correctly refused: "path ... does not exist at cited commit."

The step handler file (`bl1188PipelineGridLiveStageParitySteps.js`) IS
committed and registered (see Passed checks above), so the acceptance
*wiring* is real — only the `.feature` scenario source itself was never
`git add`ed and committed alongside it.

**Remediation:** `git add specs/features/BL-1188-pipeline-grid-live-stage-parity.feature`
and commit it (the working-tree content itself was not flagged as wrong by
this review — only its absence from history). Re-verify with `git cat-file
-e <new-commit>:specs/features/BL-1188-pipeline-grid-live-stage-parity.feature`
before forwarding again.

## Notes

- Stale-build false alarm avoided: my first property-test run showed all 3
  BL-1188 invariant tests RED with `resolveRoleHeld` apparently returning
  cache values even when live disagreed. Root cause was my own stale
  `extension/out/` (compiled before this merge landed the new
  `readLiveRoleHeldTickets` export) — `npm run compile` after the merge
  fixed it and all 3 went green. Recording this so a later pass doesn't
  waste time rediscovering it.

## Forward

Bounced to **coder**, task name carries a one-line summary. Not forwarded
to hardener. Three defects total (D1, D2, D3) in this one bounce, per
Article 4.4's complete-inventory rule.
