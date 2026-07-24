# BL-563 — architect send-back #1 (2026-07-24)

Reviewed commit: `2a834a7c48` (cleaner) — merged for review, then reverted out of
the architect branch per BL-490/BL-495.

## Verdict

**SEND BACK to coder.** Two findings. Everything else in the parcel is
architecturally sound — see "What passed" below; do not rework it.

---

## Finding 1 (correctness — must fix)

`swarmforge/scripts/swarmforge.sh:1763` — `local` at top-level script scope
emits stray output on **stdout** during every `rotation router` launch.

```sh
if [[ "$ROTATION_MODE" == "router" ]]; then
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    is_sequential_dormant "$i" || continue
    local dormant_resolved_model          # <-- top-level scope, not in a function
    dormant_resolved_model="$(resolve_claude_model_for_index "$i")"
```

That loop is at file scope (`if`/`for` do not create a scope; the enclosing
`launch_role` loop closed at the `done` on :1756). zsh permits `local` outside a
function — it is an alias for `typeset` — but `typeset <name>` on an
**already-set** variable *lists* it rather than re-declaring silently. So from
the second dormant role onward the launcher prints the previous iteration's
value to stdout.

Reproduced against the exact construct:

```console
$ zsh -c 'set -euo pipefail
for i in 1 2 3; do local v; v="x$i"; done'
v=x1
v=x2
```

Stream confirmed: the lines appear with `2>/dev/null` and vanish with
`1>/dev/null` — it is **stdout**, not stderr.

Impact: on this project's own `openrouter-kimi-sonnet-mono-router` pack the
dormant set is cleaner/architect/hardender/documenter/QA/specifier, so a launch
emits ~4-5 stray `dormant_resolved_model=<model>` lines interleaved with the
`launch script pre-generated` messages. This is the mono-router path this swarm
itself launches on.

**Remediation:** drop the `local` keyword (top-level assignment needs no
declaration), or lift the loop body into a function. Note `launch_role`'s own
`local resolved_model` on :1465 is correct — that one *is* inside a function.

---

## Finding 2 (wiring/testability — must fix)

`resolve_claude_model_for_index` has **two production callers and zero test
callers**. Both test layers re-implement its body inline instead of calling it:

| Layer | Location | What it does |
|---|---|---|
| acceptance harness | `specs/pipeline/steps/lib/bl563ModelFactoryHarness.sh`, `compose` mode | hand-rolls `agent` / `claude` guard / `claude_settings_and_flags_from_extra_cli` / `resolve_role_model` |
| unit suite | `swarmforge/scripts/test/test_model_factory_runtime_wiring.sh`, `run_compose_step_of_launch_role` | same sequence, re-inlined in a `zsh -c` heredoc |

```console
$ grep -rn "resolve_claude_model_for_index" .
swarmforge/scripts/swarmforge.sh:1142:resolve_claude_model_for_index() {
swarmforge/scripts/swarmforge.sh:1473:  resolved_model="$(resolve_claude_model_for_index "$index")"
swarmforge/scripts/swarmforge.sh:1764:    dormant_resolved_model="$(resolve_claude_model_for_index "$i")"
```

So both suites prove a **copy** of the wiring works, not the **shipped** wiring.
A defect inside `resolve_claude_model_for_index` — or in either call site —
leaves every test green. That is exactly how Finding 1 slipped past two green
suites: the router/dormant branch has no coverage at all.

This is not deferrable to the hardener. Per `engineering.prompt` (Startup
Tools), `.bb`/`.sh` swarm scripts have **no mutation/CRAP/DRY tooling wired** —
`swarmforge/scripts/test/` *is* the gate for this parcel's file types, so an
unexercised helper will not be caught mechanically downstream.

Secondary note: this also partly defeats commit `2a834a7c48`'s own stated goal
("eliminate model resolution duplication") — the duplication was removed from
production and re-introduced into the two test layers, where it is now
load-bearing.

**Remediation:**
1. Have the harness and `run_compose_step_of_launch_role` **call**
   `resolve_claude_model_for_index "$idx"` instead of re-inlining its body.
2. Add a unit case covering the `ROTATION_MODE == "router"` dormant-role
   generation loop (asserting both the generated settings/prompt artifacts and
   that the loop produces no stray stdout — which pins Finding 1).

---

## What passed (do not rework)

Verified green / clean this pass:

- **Dependency-rule gate (BL-259 hard gate):** full-repo scan —
  `Dependency-rule gate PASSED: no forbidden edges.`
- **Acceptance:** all 8 scenarios of
  `specs/features/BL-563-model-factory-runtime-wiring.feature` pass, including
  `cold-apply's freshly written overlay is the overlay the relaunched swarm
  consults` — the ticket's gap-1 seam closure. Draft correctly materialized to
  `.feature` with handlers wired (BL-233/BL-441 satisfied).
- **`test_model_factory_cli.sh`** — 16/16, including the five new
  `resolve-model` degrade cases.
- **`test_model_factory_runtime_wiring.sh`** — 5/5.
- **Architecture:** the pure decision (`model-factory-lib/resolve-role-model`)
  is correctly separated from the IO edge (`swarmforge.sh`), and
  `read-assignment-overlay!` correctly adopts `backlog_depth_lib.bb`'s
  degrade-never-crash posture as the ticket required. Seam closes via the
  canonical `MODEL_FACTORY_STATE_DIR` path, which the ticket explicitly permits.
- **`prompt_engine_cli.bb`** flag parsing (`strip-flags` / `flag-value`) handles
  `--model` and `--deterministic` in either order; covered by new cases 6-9.
- **Scope (BL-506):** clean. The BL-614/BL-615/BL-616/GH-24 files in the diff
  arrived via a legitimate `main` merge (specifier commits `d993c382c`,
  `a171fdf09`, `a3f551405`, all on `main`), not as un-ticketed additions.
- **Co-change (BL-255):** the flagged `prompt_engine_cli.bb` ↔ `swarmforge.sh` ↔
  `prompt_engine_lib.bb` cluster is the composer and its call site changing
  together by design (BL-546, BL-563). Informational; no action.

## Re-merge hazard for the architect's NEXT pass (read before reviewing rework)

This branch reverted its review-merge of `2a834a7c48` (commit `0d72deac2`), per
BL-490/BL-495. That creates the standard git revert-of-a-merge trap: when the
coder's reworked commit arrives, a plain `git merge <rework>` will bring only
the *new* changes — git still counts `2a834a7c48` as merged, so the reverted
BL-563 base content will **not** come back and the parcel will look
half-applied.

Before merging the rework, first undo the revert:

```sh
git revert --no-edit 0d72deac2     # revert the revert
git merge --no-ff <rework-commit>
```

then verify the BL-563 files are actually present (e.g.
`swarmforge/scripts/test/test_model_factory_runtime_wiring.sh`,
`specs/pipeline/steps/bl563ModelFactoryRuntimeWiringSteps.js`) before reviewing.
This exact trap bit the BL-608 pass — see commit `3295face1`
("restore files my revert+merge silently dropped").

## Out-of-parcel defect (NOT a reason for this bounce)

`swarmforge/scripts/test/test_prompt_engine_lib.sh` fails at
`prompt_engine_test_runner.bb:159` — *"stable prefix under 50KB after article
splits (< 51200 chars)"*, actual **53408**. This is **pre-existing on `main`**:
the parcel touches no file feeding the stable prefix (verified —
`git diff --name-only 9257952cf 2a834a7c48 | grep -E "constitution|roles/|PIPELINE"`
returns nothing), so the prefix content is identical to `main`'s. Filed
separately to the specifier; do **not** try to fix it in BL-563.
