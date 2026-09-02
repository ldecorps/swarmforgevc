# BL-1294 — architect bounce — 20260902

**Supersedes:** `backlog/evidence/BL-1294-architect-pass-20260902.md` (commit
`36903fd491`). That PASS was written before the mandatory self-audit
challenge — re-reading the committed diff for the audit surfaced a real
defect the first pass missed. Recorded here rather than amended, per git
discipline.

## Verdict: BOUNCE to coder. Review inventory: D1 (one item, one bounce).

Everything else from the prior PASS evidence stands unchanged (dependency
gate, co-change, invariants, all test runs) — only this one finding is new.

## D1 — the new acceptance steps file leaks two scratch directories per scenario run

`specs/pipeline/steps/bl1294FixtureScriptClosurePreservesDependencyPathsSteps.js`,
the `Given a live scripts directory` Background step (lines 38-41):

    liveDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-live-')),
    fixtureRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1294-fixture-')),

Neither `ctx.bl1294.liveDir` nor `ctx.bl1294.fixtureRoot` is ever passed to
`fs.rmSync` anywhere in the file (`grep -n "liveDir\|fixtureRoot"` — every
hit is a read/write, none a cleanup). This step runs in the feature's
`Background:`, so it fires once per scenario — 4 times for a full run of
this feature (scenario 01's two `Examples` rows, scenario 02, and scenario
03, which creates the pair via Background but never touches it, using its
own separately-cleaned `probe`/`root` dirs instead). Every run of this
feature — which will recur indefinitely as a standing acceptance
scenario — leaks 8 directories under `os.tmpdir()` that nothing ever
removes.

**Not speculative — deterministic**, confirmed by direct code reading, not
inferred from a flaky observation: I ran `grep -c rmSync` against this file
and traced every `mkdtempSync`/`rmSync` pair by hand (see table below).

| scratch dir | created | cleaned |
|---|---|---|
| `liveDir` (line 39) | Background, every scenario | **never** |
| `fixtureRoot` (line 40) | Background, every scenario | **never** |
| `probe` (line 96) | scenario 03 step | line 99, same step |
| `ctx.bl1294.root` (line 105) | scenario 03 step | line 142, final step |

The author (this same file) clearly knows the convention — it applies
correctly to `probe` and `root` — so this reads as an oversight on the two
Background-created dirs, not a framework limitation: there is no
scenario-teardown hook in `specs/pipeline/runtime.js`/`stepRegistry.js`
(confirmed absent), so cleanup is each step file's own responsibility, and
this file already demonstrates the correct pattern twice over for its
other two scratch roots.

**Why this is bounce-worthy and not a rule_proposal**: this is a concrete,
visible defect in the parcel I am holding, not a request for a durable
rule — per architect.prompt's correctness-defect rule (BL-333). Matches
this project's own recorded concern for exactly this failure class (BL-1280
mkdtemp migration invariant, BL-1289 temp-root-always-cleaned-up, BL-971 /
BL-1312 fixture-cleanup incidents) — none of which happen to cover
`specs/pipeline/steps/*.js` (BL-1280's guard scans only
`extension/test/**`; BL-1289 scans only `swarmforge/scripts` bb/shell
runners), so no automated gate would have caught this. Confirmed at least
two OTHER pre-existing `specs/pipeline/steps/*.js` files
(`backlogDepthCapOverrideSteps.js`, `bl1031BoundedChokepointSpawnReachableSubtreeSteps.js`)
have the same unticketed leak pattern — genuinely out of THIS parcel's
scope, not raised here, but named for the specifier note below rather than
silently dropped.

**Remediation direction** (not mandate): clean `liveDir`/`fixtureRoot` with
`fs.rmSync(..., { recursive: true, force: true })` at the terminal step of
each scenario that uses them (`the fixture has a file at …` and `the copy
fails naming …`), matching the pattern already used for `probe`/`root` in
this same file — or, if the cleaner/coder prefers a shared per-scenario
teardown mechanism, that is a legitimate larger fix but is not required to
close this ticket's own acceptance criteria.

## Recording

`node extension/out/tools/record-bounce.js --ticket BL-1294 --role coder
--type defect --class behavior --commit 36903fd491 --by architect
--evidence backlog/evidence/BL-1294-architect-bounce-20260902.md` (run after
committing this file; best-effort per architect.prompt, skipped if the CLI
is absent).

## Out-of-parcel note already sent, unaffected by this bounce

The pre-existing `acyclic` edge (`bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js`
↔ `specs/pipeline/steps/index.js`) reported in the superseded PASS evidence
is unrelated to this bounce and was already routed to the specifier as a
`note` — no need to resend.

By architect.
