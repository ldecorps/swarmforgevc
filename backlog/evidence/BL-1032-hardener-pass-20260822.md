# BL-1032 hardener pass — 2026-08-22

Reviewed: architect's forwarded commit `4d4a718a47` ("guard correctly scopes
by hazard, both invariants verified"), merged into `swarmforge-hardender` at
`ba00eee7a` (clean vs both parents — diffed each side, purely additive).

## Mutation coverage — this file is out of Stryker's scope

`extension/stryker.config.json`'s `mutate` is `["out/**/*.js"]` (compiled TS
output only). `specs/pipeline/steps/lib/tmuxReaperGuard.js` is plain JS under
`specs/pipeline/`, never compiled into `out/`, so no Stryker mutant is ever
generated for it — same blind spot as the `getXxxUiHtml()` inline-`<script>`
class documented in this role's standing rules, one file class over. Did a
hand-authored surgical mutation sweep instead, per that fallback.

### Mutants tried (each hand-edited into the real source, tests re-run, then
reverted — confirmed `git diff` clean after every revert)

1. **`CREATES_A_SERVER` drops the `start-server` alternative**
   (`/['"](?:new-session)['"]/`). SURVIVED — all 12 pre-existing tests still
   passed. Every BL-1032 fixture in the suite used `new-session` only;
   `start-server` (named explicitly in the guard's own comment as a
   server-creating subcommand) was never exercised.
2. **Route 2's `&&` weakened to `||`**
   (`WRITES_TMUX_ON_PATH.test(text) || PREPENDS_TO_PATH.test(text)`).
   SURVIVED against both the unit lane (12/12 still passed, including "the
   real specs/pipeline/steps tree has zero tmux-reaper violations") and the
   property lane (2/2 still passed) — no fixture anywhere isolated the two
   halves; every PATH-stub fixture in the suite carried both a `writeFileSync`
   and a `PATH=` line together.
3. **`SPAWNS_TMUX` drops the bare `spawn` alternative**, and separately drops
   the bare `exec` alternative. Both SURVIVED independently — every spawn
   fixture in the suite used `execFileSync`.

All three are real behavior gaps, not equivalent mutants (BL-234 does not
apply: each mutated regex genuinely stops recognizing a hazard shape the code
itself declares as in scope, in its own comments and alternation list).

### Fix — 5 new unit tests in `extension/test/tmuxReaperGuard.test.js`

- `start-server is a server-creating subcommand too, not just new-session`
- `writing a tmux binary with no PATH prepend is not hazardous` /
  `prepending to PATH with no tmux binary written is not hazardous` — the
  isolating pair for route 2's `&&` (this role's standing "overlapping
  self-exclusion guards each need an isolating test" rule, 2026-08-13,
  applied to a hazard-detection AND rather than a self-exclusion guard).
- `a bare spawn(...) naming tmux is a spawn route too` /
  `a bare exec(...) naming tmux is a spawn route too`

Re-ran all three mutants after adding the tests: each is now killed (the
matching new test fails on the mutant, all 17 pass on the restored source).
Confirmed the source file is byte-identical to what was merged
(`git diff specs/pipeline/steps/lib/tmuxReaperGuard.js` empty) — only the
test file changed.

## BL-113 Gherkin acceptance mutation — deferred, host load

`specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature`
carries a `Scenario Outline:` + `Examples:` (scenario 02), so BL-113 applies.
`bb swarmforge/scripts/mutation_cooldown_gate.bb <root>
specs/pipeline/steps/lib/tmuxReaperGuard.js` (with
`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, this host has no `nproc`) reported
`DECISION: skip-busy`, `load_avg: 35.03 cores: 4 busy_threshold: 2.00x`. Host
load was 43-44 on 4 cores at the top of this pass. Per the standing rule that
load gating binds every mutation runner, not Stryker alone, this is deferred
to the next quiet pass rather than run now. The acceptance feature itself
(non-mutation execution) was run live and is green: 4/4 (TAP), including
scenario 03's tree-level check.

## Verification

- `npx vitest run test/tmuxReaperGuard.test.js`: 17/17 pass (12 architect
  baseline + 5 new).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1032TmuxReaperScope.property.test.js`: 2/2 pass, unchanged.
- `npm run compile`: clean.
- `node specs/pipeline/cli.js specs/features/BL-1032-...feature`: 4/4 pass.
- Full default unit lane (`npm test`, detached via
  `swarmforge/scripts/detach_job.sh` given the host load — collected via its
  own `[detach_job] EXIT=1` marker, confirmed no orphaned processes remained
  in its process group afterward): 462/463 files, 8222/8223 tests passed.
  The one failure —
  `test/tempDirTrapGuard.test.js > the real swarmforge/scripts tree has zero
  temp-dir-trap violations`, flagging
  `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb` — is
  exactly the pre-existing violation BL-1032's own ticket names as
  out-of-scope and separately tracked (`backlog/paused/BL-1033-...yaml`),
  matching `qa_e2e_procedure` step 6's expected exception verbatim. No other
  failure anywhere in the suite.

## Verdict

Hardened. Forwarding to documenter.

By hardener.
