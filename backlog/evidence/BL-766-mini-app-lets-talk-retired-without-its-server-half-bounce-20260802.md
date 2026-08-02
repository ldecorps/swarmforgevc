# Architect bounce — BL-766

Reviewed commit: `9ef5931ced4845365b769211c042495fd03468ad`
("Reconcile BL-766 Mini App Let's Talk server/steps halves (Option B)", by coder)

## Review inventory (complete pass)

- Architecture boundary (extension host vs webview, no direct process spawn,
  no browser storage, secrets stay in extension host): PASS. The one new
  production module, `extension/src/bridge/letsTalkGateScope.ts`, is a pure,
  I/O-free helper — correctly placed on the testable side of the boundary.
- `node extension/out/tools/dependency-gate.js src/bridge/letsTalkGateScope.ts
  test/letsTalkGateScope.property.test.js` (run under node 22, dependency-cruiser's
  supported range): **PASSED, no forbidden edges.**
- `node extension/out/tools/co-change-report.js` on the 4 changed files: no
  actionable coupling. `specs/pipeline/steps/index.js`'s large co-change list is
  the expected shape for a shared step registry (every ticket that adds
  acceptance steps touches it) — not a BL-766-specific concern.
- Declared invariant 1 ("every scenario has a step handler whose assertions can
  actually pass"): stated non-encodability reason recorded per BL-654 (process
  invariant, not a single ticket's pure module), backed structurally by a real
  `run_acceptance.sh` pass and `runtime.js`'s hard-throw on unresolved steps.
  Accepted.
- Declared invariant 2 ("retiring a surface moves route+scenarios+gate
  together"): encoded as a genuine property test,
  `extension/test/letsTalkGateScope.property.test.js`. Verified running:
  `npx vitest run --config vitest.properties.config.mjs test/letsTalkGateScope.property.test.js`
  → 3/3 pass. Non-vacuous per the commit message's own break-then-restore
  check; the fuzzed shape (arbitrary candidate/live/gate-scope splits) is
  real, not degenerate.
- BL-766's own acceptance feature: ran for real —
  `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-766-mini-app-lets-talk-retired-without-its-server-half.feature
  ./tmp/bl766-acceptance-out` → **5/5 scenarios pass**, including the
  half-retired-01 scenario that drives the real BL-696 suite and confirms the
  one named, pre-existing, unrelated BL-696 gap stays the only exclusion.
- Property-testing pass (undeclared properties on touched pure modules): no
  gap — the only new pure module already carries its own property test above.

## D1 — BLOCKING: BL-766's own required gate cannot execute (class: behavior, blamed role: coder)

`extension/src/bridge/letsTalkChiptunes.ts` (already committed on this branch's
ancestry via `f175bc56`, "Park local WIP for host switch...", predating this
parcel) does `import catalogJson from './letsTalkChiptunes.json'`, which
requires `resolveJsonModule` in `extension/tsconfig.json`. That flag is **not**
in the committed `tsconfig.json` on any pipeline worktree. Reproduced from a
clean worktree:

```
$ npm run compile
> tsc -p ./
src/bridge/letsTalkChiptunes.ts(6,25): error TS2732: Cannot find module
'./letsTalkChiptunes.json'. Consider using '--resolveJsonModule' to import
module with '.json' extension.
$ echo $?
2
```

Because every gate script chains `npm run compile && ...`, this single
`tsc` failure short-circuits and blocks, verified by direct reproduction:

- `npm run test` — never reaches `recordTestDuration.js`.
- `npm run test:properties` — never reaches `vitest`.
- `npm run coverage`, `npm run coverage:lets-talk-cursor-bridge` — never reach
  `vitest --coverage`.
- **`npm run crap:lets-talk-cursor-bridge` — BL-766's own `required_wiring`
  gate and the exact command its `notes:` e2e QA procedure says to run and
  read the report from — exits 2 before `crapReport.js` ever runs. There is
  no report to read.**

This is why the property-test and acceptance-suite confirmations above had to
route around `npm run compile`'s wrapper (calling `vitest`/`run_acceptance.sh`
directly against `extension/out/`, which already held valid JS from an
earlier manual `tsc` run — `tsc` still emits on a type error unless
`noEmitOnError` is set). That workaround is not something a downstream role
should have to discover cold: a hardener picking up this parcel in a fresh
worktree, where `extension/out/bridge/letsTalkChiptunes.js` and
`extension/out/bridge/letsTalkGateScope.js` do not exist yet (confirmed absent
in the hardener worktree at the commit prior to this parcel), gets the same
opaque `TS2732` failure with no path forward via the documented gate commands.

**Not BL-766's coder's original mistake** — `f175bc56` predates this parcel
and touches none of the 4 files this parcel changed. But BL-766's own
declared required gate cannot be verified as passing while this stands, so
per Article 4.4 ("complete means run-or-blocked, never assumed-clean") this
check is recorded BLOCKED, not passing, and per the correctness-defect rule
("a defect you can see is a send-back too") it is in scope to fix before this
parcel can be forwarded with a verified gate.

**The fix is already known-correct and uncommitted**: the human's own main
checkout (`/Users/ldecorps/projects/swarmforgevc`, *not* any pipeline
worktree) carries this exact fix, uncommitted:

```diff
   "esModuleInterop": true,
+  "resolveJsonModule": true,
   "skipLibCheck": true,
```

With that one line, `npm run compile` in the main checkout succeeds cleanly
(verified). BL-765 (`backlog/paused/BL-765-...yaml`, still `status: todo`,
`human_approval: pending`) is the ticket that will eventually land this line
as part of a much larger Bubble-config scope — but nothing about BL-766
should wait on BL-765's full approval cycle for a one-line, already-proven
build-config fix.

## Remediation

Add `"resolveJsonModule": true` to `extension/tsconfig.json`'s
`compilerOptions` (matching the line already proven correct, uncommitted, in
the main checkout), then re-run `npm run crap:lets-talk-cursor-bridge` and
confirm it produces an actual report covering every live Let's Talk source
before forwarding again. This does not require touching
`letsTalkChiptunes.ts`, `letsTalkChiptunes.json`, or anything else BL-765
will eventually own — only the compiler flag.

Everything else in this parcel (the 4 files this commit actually changed) is
architecturally clean and functionally verified; re-forward once the gate can
run.
