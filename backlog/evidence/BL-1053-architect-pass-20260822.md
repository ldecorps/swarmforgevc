# BL-1053 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `986ea5211` (cleaner) into the architect worktree:
`876df1f9f` (coder, "the intelligence layer can route work to a Qwen seat")
+ `986ea5211` (cleaner, "dedupe agent-for-provider lookup in assign-role").
Merged cleanly, no conflicts. `npm run compile` clean before running any
tool against `extension/out/`, per [[architect-stale-build-gotcha]].

## Scope

Slice (b) of the qwen-code onboarding, depending on BL-1052 (already
architect-approved, `99db10c75`). Adds a `"qwen" "qwen-code"` entry to
`model_factory_lib.bb`'s `provider->agent` map; hardens
`agent-for-provider` to return `nil` instead of falling back to the
provider's own name; adds `resolve-launch-agent` as a structured
known/unknown report; makes `assign-role` throw by name when the chosen
candidate's provider has no launch agent, instead of silently building a
descriptor naming a nonexistent runtime. Seeds four Token Plan models as
`candidate` under provider `"qwen"` in `models.seed.json`. New feature file
(5 scenarios/outline rows), step handler
(`bl1053QwenProviderRoutingSteps.js`, registered in
`specs/pipeline/steps/index.js`), unit runner, and one property runner for
the ticket's single declared invariant.

The cleaner's own diff (`986ea5211`) is a pure dedupe: `assign-role`
already destructured `resolve-launch-agent`'s `:known?`/`:reason` — it now
also destructures `:agent` and reuses it for the entry's `:agent` field
instead of a second `(agent-for-provider (:provider chosen))` lookup.
Verified the two values are definitionally identical (`resolve-launch-agent`
computes `:agent` via the exact same `(get provider->agent provider)`), and
the `let`'s map literal moved from a sibling form (previously discarded —
`when chosen` had two body forms, only the second returned) to the `let`'s
own last form (now returned) — same result, no parens/scope error. Diffed
by hand at `swarmforge/scripts/model_factory_lib.bb:171-187`.

## Architecture

- Integrate-not-fork: maintenance of this project's own maintained
  SwarmForge fork under `swarmforge/scripts/` (Local Engineering
  Architecture Rule 2) — not a modification of a user's separately-installed
  SwarmForge.
- No `extension/**` file touched, no webview/extension-host boundary, no
  browser storage, no secrets. High-level policy
  (`model_factory_lib.bb`, pure) stays independent of IO — the store layer
  (`model_factory_store.bb`) is untouched by this parcel and no IO was added
  to the lib file.
- `agent-for-provider` is no longer called from production code (only from
  `assign-role`'s own `resolve-launch-agent` path now) but remains a public
  function with its own direct test coverage in both the unit and property
  runners — not dead code, a retained small public seam.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

This parcel touches zero files under `extension/` (all six changed files are
under `specs/pipeline/steps/`, `swarmforge/model-steward/`, and
`swarmforge/scripts/`). Full-repo scan (post-compile):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Identical to the three edges recorded in `BL-1052-architect-pass-20260822.md`
and multiple prior passes — pre-existing, already tracked as `BL-759`
(paused, confirmed still present in `backlog/paused/`). None of this
parcel's files touch either side of the cycle. Not re-reported per
[[architect-grep-exact-filenames-before-worth-a-ticket-note]] (this exact
cycle has already been independently re-discovered and corrected three
times; a fourth "worth a ticket?" note would repeat the documented mistake).

## Co-change (`node extension/out/tools/co-change-report.js`)

Run against all six changed files. `specs/pipeline/steps/index.js` and
`model_factory_lib.bb` show their usual long hub-file co-change lists
(dozens of historical partners each — `index.js` registers every step
handler ever added, `model_factory_lib.bb` co-changes with its own
CLI/store/test-runner siblings at frequency 6-7). None of those partners
were touched by this parcel and none needed to be: the change is additive
(one map entry, one new pure fn, one new guard clause) and the full
`model_factory_cli.bb`/`model_factory_store.bb` regression suite
(`test_model_factory_cli.sh`, 16/16) and `model_factory_test_runner.bb`
pass unchanged against it — reviewed and judged non-actionable, this tool
only informs.

## Invariant review (BL-654/BL-633) — one declared, real, verified

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | "Every provider key in the registry resolves to exactly one launch agent, and no two provider keys resolve to an agent that cannot serve them. A provider added without its own provider->agent entry falls through to another provider's binary rather than failing..." | `bl1053_provider_routing_property_runner.bb` — P1 (every registered provider resolves deterministically to a real, launcher-supported agent), P2a (the qwen/openai shortcut pair never collapses to the same agent), P2b (an unregistered provider — case variants, whitespace, agent-name-as-provider-key — reports unknown and names no agent, never a guess), P3 (`assign-role` throws by name for an unregistered provider, never builds a descriptor) | Ran green myself: `bb .../bl1053_provider_routing_property_runner.bb` → `ALL PROPERTIES HELD (300 runs)`. **Non-vacuity confirmed empirically, not trusted from the commit message**: reverted `agent-for-provider` to its pre-ticket `(get provider->agent provider provider)` fallback and re-ran the property runner — 600 failures, correctly catching the exact pre-fix bug ("agent-for-provider echoed the provider back as its own agent"); restored and confirmed `git diff` clean afterward. |

No missing/vacuous property test. `required_wiring` verified directly: the
`"qwen"` key is a live entry in the `provider->agent` map returned by
`(load-file ...)`, not just a string appearing in a comment; the step
handler is a live `require('./bl1053QwenProviderRoutingSteps')` inside the
`DOMAINS` array `registerSteps` actually iterates.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The only touched pure-logic surface (`model_factory_lib.bb`'s
`provider->agent`/`agent-for-provider`/`resolve-launch-agent`/`assign-role`)
is fully covered by the one declared invariant's property runner above —
round-trip/idempotence/ordering shapes don't apply to a static lookup map
and a single guard clause. `models.seed.json` is data, not logic. Nothing to
add.

## Correctness read-through

Read the full diff end to end, including a deliberately adversarial
question raised and then closed: `assign-role`'s new `throw` propagates
uncaught through `model_factory_cli.bb`'s `run-assign`/`run-cold-apply`
(neither catches it), unlike the CLI's other error paths which print a
clean one-line message to stderr before `System/exit 1`. Checked whether
this is reachable in production today: `role_matrix` entries (the only
input `assign-role` ranks over) come from either the committed,
human-reviewed seed file — every seeded entry uses `anthropic`/`openai`,
both registered — or `add-role-ranking`, which has **no production caller**
anywhere in `swarmforge/` outside test fixtures (grepped `swarmforge/
--include=*.bb`). So the throw path is currently unreachable except via a
hand-edited seed typo, which is exactly the class of error this ticket
exists to fail loudly on rather than silently mis-route. Reproduced the
actual failure output by hand
(`bb -e '...(assign-role reg "coder" quality-mode)'` with a fixture
unregistered-provider registry): babashka's default `ExceptionInfo` output
prints the full message — `"cannot assign role coder: unknown provider
\"mystery\" - no launch agent is registered for it. Known providers:
anthropic, cerebras, openai, qwen"` — as the first line, before any stack
trace. This satisfies the project's actual-failure-reason guardrail
(BL-572/BL-662's spirit: never a bare status) even though it's noisier than
the CLI's hand-rolled one-liners; not a correctness defect, and out of this
ticket's explicit scope ("Not in this slice: ... any autonomous seat
mutation"). Judged not bounce-worthy — noted here rather than as a
`rule_proposal`, since raising it a second time on a currently-unreachable
path would be scope creep on a ticket that itself doesn't touch the CLI.

No other defect found.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean, before running any gate.
- `node extension/out/tools/dependency-gate.js` (full-repo, post-compile):
  same 3 pre-existing BL-759 edges, confirmed above.
- `node extension/out/tools/co-change-report.js` on all 6 parcel files:
  reviewed above, no new coupling.
- `bb swarmforge/scripts/test/bl1053_qwen_provider_routing_test_runner.bb`
  → `ALL PASS`.
- `bb swarmforge/scripts/test/bl1053_provider_routing_property_runner.bb`
  → `ALL PROPERTIES HELD (300 runs)`; re-confirmed non-vacuous by an
  independent break-and-restore, see above.
- `node specs/pipeline/cli.js specs/features/BL-1053-the-intelligence-layer-can-route-work-to-a-qwen-seat.feature`
  → **7/7 pass** (TAP: `# pass 7`, `# fail 0`).
- `bb swarmforge/scripts/test/model_factory_test_runner.bb` → `ALL PASS`
  (pre-existing regression suite, unaffected).
- `bash swarmforge/scripts/test/test_model_factory_cli.sh` → **16/16 PASS**
  (CLI regression suite, unaffected by the new throw/dedupe).

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness
defect that rises to bounce-worthy in this parcel. Forwarding to hardener.

Note, not a bounce: `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
still sits untracked in this worktree, pre-existing and unrelated to
BL-1053 — already surfaced and ticketed as BL-724 per
[[stray-mono-router-auto-rotate-test-unticketed]]. Left untouched.

— By architect.
