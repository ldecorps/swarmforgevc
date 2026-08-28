# BL-1204 — architect bounce 2 — 20260828

## D1: Background's fixture root leaks unconditionally on the feature's second scenario (BL-971 shape, fifth occurrence this session)

**File:** `specs/pipeline/steps/bl1204RedeployTargetsReachableAndListedSteps.js`

**Defect:** the feature's `Background` step
(`the Cursor bridge is accepting Telegram commands`) unconditionally
creates a real fixture directory on every scenario:
```js
scoped(registry, /^the Cursor bridge is accepting Telegram commands$/, (ctx) => {
  ctx.bl1204 = { root: mkFixtureRoot() };
});
```
Only the outline scenario ("A built redeploy target is reachable from
Telegram") ever uses or cleans up `st.root` (in its own terminal step,
line 129: `fs.rmSync(st.root, ...)`). The feature's OTHER scenario ("The
help message lists exactly the redeploy targets the bridge accepts") also
runs the Background (Gherkin backgrounds apply to every scenario in the
feature), so it also gets a `mkFixtureRoot()` call — then immediately
discards the reference:
```js
scoped(registry, /^the operator asks for help$/, (ctx) => {
  ctx.bl1204 = { help: formatHelpMessage() };   // overwrites ctx.bl1204, losing `root`
});
```
The fixture directory created for this scenario is never referenced again
and never removed.

**Confirmed live, deterministic — leaks on every single passing run, not
just on failure:** instrumented `mkFixtureRoot`/the cleanup call with
`console.error` and ran the feature once:
```
DEBUG CREATED /tmp/bl1204-acceptance-bdJJ9J
DEBUG REMOVING /tmp/bl1204-acceptance-bdJJ9J for target frontdesk
DEBUG CREATED /tmp/bl1204-acceptance-agfXTO
DEBUG REMOVING /tmp/bl1204-acceptance-agfXTO for target all
DEBUG CREATED /tmp/bl1204-acceptance-6RKpSp
DEBUG REMOVING /tmp/bl1204-acceptance-6RKpSp for target miniapp
DEBUG CREATED /tmp/bl1204-acceptance-eOwc6i        <- for the help-message scenario's own Background
```
4 created, 3 removed, every run — confirmed across 3 consecutive full
`run_acceptance.sh` invocations (1 leaked dir after each, 3 total).
Debug instrumentation reverted (`git checkout --` on the file) after
confirming; nothing here required a code change to reproduce, this is not
a hypothetical failure-path case like the prior three occurrences — it
happens on 4/4 GREEN.

**Not a re-report of a standing ticket:** this is the FIFTH occurrence of
the BL-971 fixture-cleanup class this session (BL-1205 D1, BL-1213
cleaner-found + specifier-fixed, BL-1203 my own bounce this session, now
this — a fresh instance in BL-1204's own re-delivered step handler, not a
repeat of any of those).

**Remediation, direction not mandate:** the Background should not create
a fixture the scenario might not use. Either (a) move `mkFixtureRoot()`
out of the Background into the outline scenario's own first step (the
help-message scenario needs no root at all), or (b) if the Background
must stay shared, register a step-registry-level `afterEach`-shaped
cleanup (if the registry supports one) that removes `ctx.bl1204?.root`
unconditionally regardless of which scenario ran — matching the
`cleanupFixtureState`-in-multiple-terminal-steps pattern already used in
this same directory (`bl1213ParcelRollbackGuardSteps.js`,
`bl1205HandoffRefusesAMassDeletionForwardSteps.js`), generalized to cover
a scenario that never reaches ANY of those terminal steps at all.

**Given this is now the FIFTH occurrence of the identical class this
session** (BL-1205, BL-1213, BL-1203, and now BL-1204's first AND second
delivery), I am also filing a `rule_proposal` to the specifier for a
durable lint/CI gate over this directory, separate from this bounce.

## Everything else checked — genuinely clean (Article 4.4 full inventory)

| Check | Result |
|---|---|
| The original D1 (missing step handler) from my first bounce | Fixed — step handler exists, registered in `index.js` |
| The race-condition D1 cleaner separately bounced (synchronous marker read racing detached spawn) | Fixed correctly — bounded poll (25ms/3s), verified 5 consecutive runs stable by cleaner, reconfirmed stable by me across 3 more runs |
| Dependency gate | N/A — no `extension/src/**` files touched in this specific re-fix commit (only the step-handler `.js` file changed) |
| `npm run compile` (from `extension/`) | Clean |
| Acceptance (`run_acceptance.sh` on the BL-1204 feature) | 4/4 pass, all 3 runs — the dispatch/help-parity fix itself is correct and stable |

**The underlying `/redeploy frontdesk`/`/redeploy all` dispatch fix, the
help-text parity, and the async-marker race fix are all solid and
correctly verified** — this bounce is narrowly about the Background's
unconditional, uncleaned fixture creation.

## Routing

Per Article 4.3, owning stage is **coder** — mechanical fixture-lifecycle
fix in test code, no production logic involved.

By architect.
