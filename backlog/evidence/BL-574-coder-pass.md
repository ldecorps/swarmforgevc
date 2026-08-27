# BL-574 — coder pass

Received `merge_and_process specifier 07a3c601f0` (BL-574's spec commit,
already an ancestor of the coder branch — no merge needed, confirmed via
`git merge-base --is-ancestor`). Implemented BL-546 Slice 2: a named fragment
registry, a content-hash fragment cache, and a per-model/provider adapter
registry, in `swarmforge/scripts/prompt_engine_lib.bb`.

## What was built

- **Fragment registry**: `fragment-source-path` / `fragment-content-uncached`
  resolve each named fragment (`constitution`, `pipeline`, `role`,
  `pack-overlay`, `tool-instructions`) to its content, by reference — editing
  a fragment file changes the composed prompt with no edit to `compose`.
- **Content-hash fragment cache**: `empty-fragment-cache`, `read-fragment`
  (pure, injectable `content-fn` IO seam), `read-fragment!` (impure
  single-threaded convenience), `invalidate-fragment` (explicit eviction).
  Cache key is the fragment name; each entry stores a SHA-256 hash + content.
  No automatic mtime-based invalidation, deliberately: BL-373's worktree
  hot-sync touches mtime independent of content, so a mtime-gated cache would
  effectively never hit in this environment. A fragment stays cached until an
  explicit `invalidate-fragment` call says it changed.
- **Adapter registry**: `default-adapter-registry`, `register-adapter!`,
  `select-adapter` — registry-driven (BL-206): adding a provider's adapter is
  one map entry, `compose`'s own dispatch never branches on provider name.
  `compose`'s metadata now carries `:adapter-id`.
- `generic-bootstrap-text` and `compose` now thread a `:fragment-cache`
  atom + `:fragment-content-fn` through the role/pack-overlay reads (the two
  per-request single-file fragments); constitution/pipeline stay on the
  existing `stable-bootstrap-prefix` path (one aggregated, request-independent
  read already). Both new context keys are optional — an existing caller that
  passes neither gets a fresh cache and the real reader every call, i.e.
  byte-identical behavior to before this ticket.

## Downstream consumer fix (not a ticket scope-creep — a break I caused)

`generic-bootstrap-text`'s arity grew from 5 to 7 params.
`swarmforge/scripts/agent_runtime_lib.bb`'s own `generic-bootstrap-text`
(a pre-BL-546 thin delegate kept for compat, line ~178) called the OLD
5-arity signature and would have thrown on any actual invocation. Fixed the
delegate to supply a fresh cache atom + the real content-fn, preserving its
own 5-arg public signature and exact prior behavior. Grepped every other
`prompt-engine-lib/` call site (`cache_warm_lib.bb`, `expedite_cli.bb`,
`model_steward_store.bb`) — all go through `compose`'s map-based API
(unaffected) or unrelated delegates; none call `generic-bootstrap-text`
directly.

## Draft trim (ticket's own scope)

Trimmed the two now-materialized Slice 2 scenarios out of
`specs/features/BL-546-prompt-engine-slices-2-3.feature.draft`, leaving Slice
3 (versioning, validation, inspect CLI) parked, per the ticket's notes
("the draft is trimmed to Slice 3 only in the same parcel").

## Tests

- `swarmforge/scripts/test/prompt_engine_test_runner.bb`: extended with
  fragment-registry, cache-hit/invalidation, and adapter-registry pure-lib
  assertions. All pass.
- `swarmforge/scripts/test/prompt_engine_fragment_cache_property_runner.bb`
  (new): BL-654 property test for the ticket's declared invariant (below).
- `specs/features/BL-574-prompt-engine-slice2-fragments-adapters.feature` via
  `specs/pipeline/scripts/run_acceptance.sh`: all 9 scenarios pass, backed by
  new `specs/pipeline/steps/bl574PromptEngineFragmentsAdaptersSteps.js`,
  driving the real `prompt_engine_lib.bb` through `bb -e` subprocess calls
  (this repo's established pattern for Babashka-backed Gherkin steps — see
  `backlogDepthCapOverrideSteps.js`). Non-vacuity proven twice: broke
  `select-adapter` to always return `"generic"` — scenarios 6/7 failed as
  expected (5 stayed green since claude's real default genuinely is
  `"generic"`); separately broke `read-fragment`'s cache-hit branch to always
  re-read — scenario 8 failed as expected. Both restored, all green again.
- `agent_runtime_test_runner.bb` / `test_agent_runtime_lib.sh` and
  `cache_warm_test_runner.bb` / `test_cache_warm_lib.sh`: all pass (proving
  the downstream-consumer fix above is correct).
- `test_prompt_engine_lib.sh`: extended with a new case 10 (compose-metadata
  carries `adapter-id`), verified by hand (see note below).

### Pre-existing, out-of-scope failure — not fixed here

`prompt_engine_test_runner.bb`'s existing "stable prefix under 50KB" assertion
now fails (65138 chars). Confirmed via `git stash` that this fails identically
on the pre-BL-574 tree — the constitution has grown past BL-618's cap since
that ticket closed (BL-681's Article 5.3 among the recent additions), unrelated
to fragment/adapter work. `set -euo pipefail` in `test_prompt_engine_lib.sh`
means this pre-existing failure aborts the script before reaching the CLI-level
cases; every remaining case (02–10, including the new case 10 above) was
verified by hand, matching the script's own commands exactly — all pass.
Surfacing this to the coordinator/specifier separately (BL-618 is a recurring
cap regression, not a BL-574 defect) rather than fixing it in this parcel.

## BL-654 declared-invariant coverage

Ticket declares one invariant: *"Composed prompt output is byte-identical
with the fragment cache cold, warm, or invalidated — caching may change
latency, never content."*

**Property test authored**:
`swarmforge/scripts/test/prompt_engine_fragment_cache_property_runner.bb`.
200 generated runs over (role × overlay-prompt × two-pack? × agent) drawn
from this repo's real role/pack-overlay files, composing cold (fresh cache),
warm (same cache, unchanged request), then invalidated (role + pack-overlay
explicitly evicted, forcing a fresh real-file read) — asserts all three
`:system-prompt` values are byte-identical. Generator coverage asserted
(113/200 distinct requests over 200 runs), not assumed.

Non-vacuity: temporarily made `read-fragment`'s cache-hit branch return a
hardcoded `"[[cache]]"` sentinel instead of the cached content — every
generated run failed (warm/invalidated output differed from cold) — then
restored before commit.

## Handoff

`git_handoff` to `cleaner`, priority `50`, task `BL-574`.
