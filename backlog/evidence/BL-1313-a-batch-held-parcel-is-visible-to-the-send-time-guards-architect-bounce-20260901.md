# BL-1313: architect review — bounce — 2026-09-01

Reviewed commit `7a1d695b63` (merge of cleaner's `f47a529602`, coder's
`eb32525012` underneath), against
`backlog/paused/BL-1313-a-batch-held-parcel-is-visible-to-the-send-time-guards.yaml`.

## Checklist run

- Dependency gate (`node extension/out/tools/dependency-gate.js`, no-args
  full-repo scan, per the `bl259` invocation note for parcels straddling the
  `extension/` boundary): **PASSED, no forbidden edges.** (A scoped-args
  invocation on just the parcel's `.js` files reported a stale-looking
  `acyclic` cycle between `bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js`
  and `index.js` — not present in the full-repo scan, and not touching any
  BL-1313 file; read as the known scoped-subset artifact, not a real edge.)
- Co-change (`node extension/out/tools/co-change-report.js` over all 10
  changed files): the two new BL-1313 files (property test, step handlers)
  co-change with each other and with the rest of the parcel at frequency 1
  each — below the suspicion threshold. `specs/pipeline/steps/index.js`
  flags dozens of "SUSPECTED COUPLING" partners at high frequency — expected
  hub noise for the central step-registry file every ticket's step handler
  touches, not new coupling introduced by this parcel.
- Correctness read of `duplicate_chain_guard_lib.bb` and `swarm_handoff.bb`:
  both call-site swaps are scoped exactly right (`duplicate_chain_guard_lib.bb`
  branches on `state = :in_process` only, leaving other states on the flat
  reader; `swarm_handoff.bb`'s `inbound-non-forwarding?` swaps unconditionally,
  correct since it only ever reads its own `:in_process`). Grepped both files
  for any other `handoff-files`/`my-handoff-files` call site in guard logic —
  none missed.
- Wiring: `bl1313BatchGuardVisibilitySteps.js` registered in
  `specs/pipeline/steps/index.js:913`; both new standing tests
  (`bl1313_handoff_files_with_batches_test_runner.bb`,
  `test_swarm_handoff_inbound_non_forwarding_batch.sh`) registered in
  `suite-manifest.tsv`.
- Acceptance: ran `node specs/pipeline/cli.js specs/features/BL-1313-....feature`
  myself — 7/7 scenarios pass, genuinely exercising the real `swarm_handoff.bb`
  CLI via subprocess (no patching in the step handlers).
- Shell fixture: ran `test_swarm_handoff_inbound_non_forwarding_batch.sh`
  myself — PASS, same real-CLI coverage.
- bb unit runner: ran `bl1313_handoff_files_with_batches_test_runner.bb`
  myself — ALL TESTS PASSED against the real, unpatched `handoff_lib.bb`.

## D1 (invariant-unencoded): the property test verifies a hand-duplicated copy, not the shipped code

`extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js` heads
itself: "Drives the REAL bb code via spawnSync - no model of the guard, no
stub." It is not. Its `PATCH_EVAL` block (lines 41–52) re-`defn`s
`handoff-files-with-batches` and `my-handoff-files-with-batches` inside the
`handoff-lib` namespace, via `(in-ns 'handoff-lib)`, immediately after
`load-file`-ing the real `handoff_lib.bb` — in every one of `listVisible`'s
and `blockingParcel`'s subprocess invocations. The redefinition wins (last
def in the namespace), so both declared-invariant tests exercise the
test file's own literal copy of the two new readers, never whichever
version is actually committed in `handoff_lib.bb`.

**Empirically confirmed** (reverted after, working tree left clean):
replaced the real `handoff-files-with-batches` in `swarmforge/scripts/handoff_lib.bb`
with `(defn handoff-files-with-batches [dir] (handoff-files dir))` — i.e.
made it silently ignore all batch directories, the exact defect this
ticket exists to fix — then re-ran:

- `npx vitest run --config vitest.properties.config.mjs test/bl1313BatchGuardVisibilityInvariants.property.test.js`
  → **2/2 still passed.** The property test the ticket's own `invariants:`
  block requires did not bite.
- `bb swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`
  (unpatched, loads the same real file) → **4/7 assertions correctly
  FAILED**, naming the exact break.

So the invariant *is* covered — by the bb unit runner and by the acceptance
feature (both drive the real committed file/CLI unmodified) — but the
`*.property.test.js` artifact the Invariants Review requires for each
declared invariant is vacuous on its own terms, per the send-back rule:
"A missing or vacuous property test (one that stays green against a
deliberately broken implementation) is itself a send-back."

The file's own comment explains the motive ("handoff_lib.bb is periodically
reverted to HEAD by a background daemon while the test runs") but the
chosen fix (duplicate the logic inline) defeats the property test's purpose
regardless of whether that reversion risk is still real post-commit. The
acceptance step handlers hit the same class of environmental hazard and
solved it without duplicating logic — real subprocess calls into the
committed `.bb` files, no patching. Remediation is the coder's call: confirm
whether the reversion risk is real against committed HEAD content in a test
run, and if so isolate it (e.g. read/copy the real file's content into an
isolated fixture location at test-start, or eliminate the redefinition
entirely) rather than re-deriving the functions' logic by hand inside the
test file.

## Decision

One send-back, class `invariant-unencoded`, routed to **coder** (the
property test's own author, per the Invariants section — never
hand-verified/fixed here). No other defect found; this is the complete
inventory for this pass.
