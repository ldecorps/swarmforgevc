# BL-968 — architect review pass: BOUNCE to coder (fixture-leak-on-partial-failure defect)

- **Ticket**: BL-968 — the BL-761 acceptance-contract gate is blind on
  effectively every send because three step files ran `git rev-parse` at
  module load, killing the require chain in the gate's materialized
  non-repo temp tree.
- **Received**: `git_handoff` from cleaner, `c8d791dc80` ("BL-968 cleanup:
  extract shared lazy() memoizer for the five load-time-binding fixes"),
  task `BL-968-step-registry-loadable-from-materialized-tree`. Built on the
  coder's `20e315ceb1`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **BOUNCE to coder — 1 defect (D1, correctness/fixture-leak).**

The two declared invariants are both correctly and non-vacuously encoded
(re-verified independently below), the five load-time-binding call sites
are all correctly converted to `lazy()`, the dependency-rule gate has no
scope on this parcel (no `extension/src`/`extension/media` file touched),
and `co-change-report.js` flags nothing above threshold. The parcel is
architecturally clean. One concrete correctness defect was found while
reading the acceptance step handlers: a temp-dir cleanup path that claims
to prevent a leak but does not.

---

## D1 — `materializeIntoCtx`'s partial-materialization cleanup cannot see the tree it is supposed to remove

**Class**: `behavior` (fixture-leak-on-failure) · **Blamed**: coder ·
**File**: `specs/pipeline/steps/bl968StepRegistryMaterializedTreeSteps.js:53-66`

```js
function materializeIntoCtx(ctx) {
  let made;
  try {
    made = materializeCurrentPipeline();
  } catch (err) {
    // A partial materialization must not leak its temp root.
    if (made) {
      rmTreeQuietly(made.root);
    }
    throw err;
  }
  ctx.guardRoot = made.root;
  ctx.pipelineDir = made.pipelineDir;
}
```

`materializeCurrentPipeline()` (in
`extension/test/helpers/materializedRegistryGuard.js:27-39`) creates its
temp root via `mkSharedTmpDir` as its FIRST statement, then does
`fs.mkdirSync` / `fs.cpSync` (a recursive copy of the whole
`specs/pipeline` tree) / `fs.symlinkSync` afterward — any of which can
throw (a concurrent writer touching `specs/pipeline` mid-copy, ENOSPC, a
broken symlink under `node_modules`/`extension`, a permission error — all
plausible under real swarm load, which is exactly the environment this
step handler runs in). When it throws, the function never returns, so the
assignment `made = materializeCurrentPipeline()` never completes and `made`
stays `undefined` in the `catch` block. `if (made)` is therefore always
false on this path, `rmTreeQuietly` never runs, and the temp root —
already created on disk, already holding however much of the `specs/pipeline`
copy completed before the throw — is never removed. The comment directly
above the dead branch ("A partial materialization must not leak its temp
root") states the intended contract; the code does not implement it.

**Why this matters here specifically, not hypothetically**: the guard
helper's own comment (`materializedRegistryGuard.js:13-18`) says outside
vitest — i.e. exactly these acceptance step handlers —
"no sweep ever runs, so explicit removal remains the ONE cleanup path
there." The two vitest lanes (`bl968StepRegistryMaterializedTreeGuard.test.js`,
`bl968MaterializedGuardSensitivity.property.test.js`) are safe regardless
of this bug, because `mkSharedTmpDir` registers the root for a per-file
`afterAll` sweep (`tmpDir.js:38-42`) at creation time, before any later
statement in `materializeCurrentPipeline` can throw — the sweep doesn't
care whether the function that requested the dir ever returned. Only the
acceptance-step path (`registry-materialized-load-01`/`-02`'s Given steps,
both routed through `materializeIntoCtx`) has no such backstop, and it is
precisely there that the one manual cleanup path is unreachable on the
failure it names. This is the same class of defect the engineering rules
call out by name ("a fixture dir from `fs.mkdtempSync` is removed in a
`finally`, never only after the last assertion — a test that throws or
bounces otherwise leaks it permanently") and the same class BL-984 was
just filed for in the property lane last cycle.

**Reproduction (traced, not run destructively against the real tree)**:
force `fs.cpSync` inside `materializeCurrentPipeline` to throw after
`mkSharedTmpDir` has already returned a root (e.g. temporarily copy from a
nonexistent source path) and call `materializeIntoCtx({})` — the thrown
error propagates correctly (the acceptance scenario still fails, which is
right), but `pending Shared`'s already-registered root, and the disk
directory it names, are both left behind; `made` in the caller is
`undefined` so the existing `if (made)` guard never fires.

**Remediation**: move the failure handling inside
`materializeCurrentPipeline` itself, where the `root` variable that
`mkSharedTmpDir` returned is actually in scope, e.g.:

```js
function materializeCurrentPipeline() {
  const root = mkSharedTmpDir('bl968-materialized-');
  try {
    const dest = path.join(root, 'specs', 'pipeline');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, 'specs', 'pipeline'), dest, { recursive: true });
    for (const sibling of ['node_modules', 'extension']) {
      const target = path.join(REPO_ROOT, sibling);
      if (fs.existsSync(target)) {
        fs.symlinkSync(fs.realpathSync(target), path.join(root, sibling));
      }
    }
    return { root, pipelineDir: dest };
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }
}
```

This makes the function's own contract self-consistent ("either returns a
valid `{root, pipelineDir}` or leaves no temp dir behind") for every
caller, including the two vitest lanes' `beforeAll` hooks — no caller has
to reach into the function's internals to guess the path afterward. Once
fixed, `materializeIntoCtx`'s `if (made)` branch in
`bl968StepRegistryMaterializedTreeSteps.js` becomes genuinely dead (the
helper never leaves a partial root behind to find) and can be deleted along
with its now-inaccurate comment, or left as defense-in-depth — either is
fine; the fix belongs in the helper, not the caller.

---

## Everything else — reviewed and clean

| Check | Result |
|---|---|
| Invariant 1 (registry loadable from materialized tree; no step-file subprocess/git-root/live-repo-state at module load) | **Encoded correctly**, exhaustively (`bl968StepRegistryMaterializedTreeGuard.test.js`, over the full current registry via the real resolver) — non-vacuity re-verified live this pass (staged both documented breaks, both went RED as claimed, restored) |
| Invariant 2 (standing guard proves invariant 1 continuously) | **Encoded correctly**, generatively (`bl968MaterializedGuardSensitivity.property.test.js`, 3 offender classes × 2 chain depths, reach floors asserted) — re-ran live this pass: green, coverage `{"cls":{"git-root-resolve":6,"live-repo-read":9,"benign-subprocess":9},"depth":{"direct":10,"via-lib":14}}` |
| All 5 load-time-binding call sites converted to `lazy()` | Verified by grep — no remaining eager `resolveMainCheckout(__dirname)`, `MAIN_CHECKOUT` (non-called), `BB_BIN`/`GIT_BIN`, or ungated `swarmEnsureSource` reference anywhere in the five files |
| Dependency-rule gate (`dependency-gate.js`) | **N/A this parcel** — every changed file is under `specs/pipeline/steps/` or `extension/test/`; none is under `extension/src/` or `extension/media/`, the gate's only scope |
| Co-change coupling (`co-change-report.js`) | Nothing at or above the default threshold (3); every co-change reported is 1-2 and entirely within this parcel's own file set |
| Property-testing pass (undeclared properties on touched pure modules) | The cleaner's new `specs/pipeline/steps/lib/lazy.js` extraction was undercovered (no test anywhere called it directly). Added `extension/test/bl968LazyMemoizationInvariant.property.test.js` (memoization invariant: N calls to the getter invoke `resolve` exactly once, every call returns the same value) — non-vacuous, staged break (dropped the `resolved` guard) went RED on the call-count assertion, restored; `npm run test:properties` green on this file |
| Secrets / webview / browser-storage / integrate-not-fork | N/A — no `extension/media`, secrets, or `swarmforge/` source files touched |

No checks were blocked by D1 (it does not prevent running anything else in
this inventory).
