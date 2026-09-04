# Step handlers register by discovery, not by a shared array (BL-1371)

## What changed

`specs/pipeline/steps/index.js` used to hold a hand-maintained `DOMAINS`
array of `require('./blNNNSteps')` lines — one per step-handler file, 937 of
them by the time this ticket landed. Every ticket that added an acceptance
scenario appended a line to that one shared file, and every gate that reasons
about "whose work is in this commit" (merge adjudication, land replay, land
entanglement) correctly reported the resulting coupling — three separate
incident classes traced back to it (BL-1324, BL-1359, BL-1356/BL-1371's own
land deadlock).

`index.js` now discovers its handlers instead of naming them: it reads its
own directory for top-level `*Steps.js` files and requires each one, eagerly,
at module load — `discoverHandlerFiles()` / `loadHandlers()` /
`registerLoadedHandlers()`, still exporting `registerSteps` unchanged. A new
handler file registers itself by existing in `specs/pipeline/steps/`; no
other file needs an edit.

## What this means for a new ticket

- **A new step handler needs no `required_wiring` entry naming
  `specs/pipeline/steps/index.js`.** That was the single most common
  `required_wiring` anchor in this backlog, and it proved nothing even before
  this change (the parcel's own diff always satisfied it — BL-1235). Point
  `required_wiring` at the handler file's own export instead
  (`specs/pipeline/steps/blNNNSteps.js::module.exports = { registerSteps }`,
  or similar), or at the acceptance feature/property test that actually
  exercises it.
- **A file that cannot be `require`d fails the run loudly**, naming the file
  and preserving the underlying cause on the stack — discovery never
  silently skips a handler it could not load (this ticket's invariant 2). A
  half-finished `*Steps.js` file on a branch now breaks that branch's
  acceptance runs immediately, rather than being invisible until some later
  ticket adds a require line for it.
- **A file outside the `*Steps.js` naming predicate, or nested in a
  subdirectory of `specs/pipeline/steps/`, is not discovered** —
  `specs/pipeline/steps/lib/*.js` helper modules and the handful of
  `*Only.js` focused entry points are unaffected by discovery and keep
  whatever wiring they already had.
- `check_feature_handler_registration.sh` (BL-1303) still runs, narrowed
  rather than retired: it still refuses a handler file present but
  unreachable from the registry (a shape discovery cannot produce for a
  conforming file, but still possible for a misnamed/nested one).
  `unreachableStepHandlerCheck` is untouched — it asks whether a registered
  pattern matches any feature step, which is unaffected by how handlers are
  found.
- Both acceptance runners (`run_acceptance.sh`, `run_gherkin_mutation.sh`)
  still default `STEPS_MODULE` to `specs/pipeline/steps/index.js` — neither
  needed an edit, since the change is inside that module.
- **A handler whose `require` graph cannot resolve now stops it before
  `main`, not just at the next acceptance run.** Discovery's own "fails the
  run loudly" (above) is a RUNTIME guarantee — it does not stop a handler
  requiring a not-yet-landed compiled module (e.g.
  `path.join(EXT_ROOT,'out',...)`) from reaching `main` in the first place,
  which is exactly what happened 2026-09-04: one hand-landed handler with
  an unresolvable require took every acceptance run on `origin/main` to
  zero runnable features. `check_handler_module_graph.sh` (BL-1385) proves
  every discovered handler's module graph resolves ON THE TREE UNDER TEST
  (never the checking worktree's own files) before a commit can reach
  `main`, wired into both the land replay's tree-guard list
  (`land_step_lib.bb`) and the commit-time guard chain
  (`run_commit_guards.sh`, see
  [BL-1252](BL-1252-commit-guard-chain-reports-every-violation.md)).

## Why

See `backlog/paused/BL-1371-a-step-handler-registers-without-a-shared-file.yaml`
for the full incident history and the three declared invariants, and
`backlog/evidence/BL-1371-coder-pass-20260903.md` for the migration proof
(937 handler identities / 13754 registrations compared as sets, and a
19693-step per-step resolution-parity check across all 1059 feature files).

Acceptance:
`specs/features/BL-1371-a-step-handler-registers-without-a-shared-file.feature`.
