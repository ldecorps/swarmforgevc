# BL-563 — architect PASS (rework review, 2026-07-24)

Reviewed commit: `228f327f3a` (cleaner → architect), merged for review at
`903f7aff1`. Prior verdict: send-back #1
(`backlog/evidence/BL-563-architect-bounce-20260724.md`, commit `74c502326`).

## Verdict

**PASS — forward to hardender.** Both send-back findings are fixed, and both
fixes were verified non-vacuously (break-then-restore). One out-of-parcel
process finding is recorded at the end; it is **not** a reason to hold this
parcel.

---

## Finding 1 (stray stdout) — FIXED

The top-level `local dormant_resolved_model` is gone. The `rotation router`
dormant loop body was lifted into a real function,
`generate_dormant_role_launch_artifacts` (`swarmforge.sh:1158`), where `local`
is legitimate; the top-level loop (`:1777`) now just filters and delegates.

Systemic check — no `local` remains at file scope anywhere in `swarmforge.sh`
(the single hit, `:1041`, is inside `agent-runtime-needs-bootstrap()`).

**Non-vacuity proof.** Injected `echo "dormant_resolved_model=BREAKTEST"` into
the new function and re-ran the unit suite:

```console
FAIL: 07: dormant-role generation leaked 'dormant_resolved_model=' to stdout
     across repeated calls, got: dormant_resolved_model=BREAKTEST
EXIT: 1
```

Restored; worktree clean against HEAD. Case 07 calls the function twice in one
shell process, reproducing the >1-iteration condition the original bug needed.

## Finding 2 (untested shipped wiring) — FIXED

Both test layers now **call** `resolve_claude_model_for_index` instead of
re-inlining its body:

| Layer | Location |
|---|---|
| acceptance harness | `bl563ModelFactoryHarness.sh:42` |
| unit suite | `test_model_factory_runtime_wiring.sh:107` |

`generate_dormant_role_launch_artifacts` likewise has a production caller
(`swarmforge.sh:1777`) and a test caller (`:196`), so the router/dormant branch
that had zero coverage is now exercised.

**Non-vacuity proof.** Replaced the helper's body with a constant
(`resolved_model="MUTANT-MODEL"`) — caught by **both** layers, which is exactly
what re-inlining previously prevented:

```console
=== UNIT ===        FAIL: 06 … got {"model":"MUTANT-MODEL", …}
=== ACCEPTANCE ===  # pass 7 / # fail 1
```

Restored; worktree clean.

## Architecture — compliant

- **Decision/IO split as the ticket mandates.** The overlay-over-pack decision
  is the pure `.bb` function (`model_factory_cli.bb resolve-model`);
  `resolve_role_model` (`:1127`) is the thin shell IO edge that degrades to the
  pack model on any failure; `resolve_claude_model_for_index` is the index
  adapter. Both writers — `write_claude_settings_file` (settings) and
  `write_agent_instruction_file` (compose) — funnel through the *same*
  `resolve_role_model`, so slice 1 and slice 2 cannot diverge on the model.
- **Degrade-never-crash reader reused, not reinvented.**
  `model_factory_store.bb/read-assignment-overlay!` mirrors
  `backlog_depth_lib.bb`'s posture (try/catch → nil, blank → nil), as the ticket
  explicitly required.
- **Slice 2 stays inside its scope.** The `.md.metadata.json` sidecar is written
  on the real launch path and read only by tests — correct: adapter consumption
  is BL-574's scope, and the ticket asks only that the call site become truthful.
- **Two-layer boundary, host-owns-IO, no webview storage, secrets, and
  integrate-not-fork** are all untouched by this parcel (no `extension/` or
  webview files changed; the overlay carries model ids only).

## Gates run

| Gate | Result |
|---|---|
| Dependency-rule gate (BL-259), full-repo scan | **PASSED**, exit 0, no forbidden edges |
| `test_model_factory_runtime_wiring.sh` | ALL PASS (7 cases incl. new 07) |
| Acceptance, `BL-563-model-factory-runtime-wiring.feature` | **8/8 pass**, exit 0 |
| Feature materialization (BL-233/BL-441) | `.feature` (not `.draft`), 6 scenarios, handlers registered at `steps/index.js:313` |

**Co-change (BL-255):** informational only. `swarmforge.sh` reads as a hub file
(co-changes with most of the tree); the BL-563 cluster
(`model_factory_{cli,lib,store}.bb` ↔ `prompt_engine_cli.bb` ↔ harness) is the
composer and its call site changing together by design. No action.

**Property testing:** no property test is warranted for this parcel, and none was
added. Every pure module it touches is Babashka (`model_factory_store.bb`,
`prompt_engine_cli.bb`) or zsh; the project's property framework is fast-check
over `extension/test/*.property.test.js`, which cannot reach them. The only JS in
the parcel is acceptance step glue, not a pure module with invariants. Stating
this rather than manufacturing a vacuous property.

**Pre-existing, out of parcel:** `test_prompt_engine_lib.sh` still fails on
*"stable prefix under 50KB after article splits"* (53408 chars). Re-verified as
NOT parcel-caused: `git diff --name-only $(git merge-base main HEAD) HEAD`
matches no `constitution|roles/|PIPELINE|prompt_engine_lib` path, and the parcel
made no change to that test file's assertions. Already filed to the specifier
during send-back #1. Do not fix it here.

---

## Out-of-parcel process finding — BL-563's code is ALREADY on `main`

Not a defect in this parcel, and **not** a reason to bounce it — recorded so the
remaining stages and the coordinator are not surprised.

`228f327f3a` — the commit I am reviewing — is already an ancestor of `main`, and
BL-563's production files on `main` are **byte-identical** to the ones under
review (`swarmforge.sh`, `model_factory_lib.bb`, `prompt_engine_cli.bb`,
`bl563ModelFactoryHarness.sh`, `test_model_factory_runtime_wiring.sh` all verify
IDENTICAL against `main`). Meanwhile the ticket still sits in `backlog/active/`.

How it got there:

```
228f327f3a  BL-563 rework (coder branch tip, awaiting architect)
   └─ bb4678438  Merge … into swarmforge-coder
        └─ decd25110  BL-617: nightly cooldown window scheduler
             └─ 5963497b2  Merge origin/main into swarmforge-QA for BL-617
                  └─ main
```

BL-617 was built on the coder's long-lived branch whose tip still carried the
un-reviewed BL-563 rework, so QA's BL-617 approval carried BL-563 to `main` as an
ancestor. This is the **BL-506 class** — *"An Approval Authorizes Only Its
Ticket's Work"* — arriving structurally rather than through a stray `git add -A`:
whenever two tickets are in flight concurrently and the later one overtakes, the
earlier one's in-review content ships with it.

Consequences downstream stages should know:

1. Hardener/documenter/QA are reviewing code that is already live on `main`.
2. QA's land-on-`main` step for BL-563 will be a near no-op for the production
   files; the ticket still needs its normal `backlog/active/` → `done/` move.
3. Reverting is the wrong remedy here — the content passes review on its merits.

The durable fix (a mechanism preventing a later ticket's approval from carrying
an earlier in-flight ticket, e.g. branching each parcel from `main` rather than
from the role branch tip) is a ticket for the specifier, not a change to this
parcel.
