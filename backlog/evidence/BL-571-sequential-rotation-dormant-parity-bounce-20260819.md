# BL-571 — architect review pass 1 — COMPLETE REVIEW INVENTORY (Article 4.4)

- **Ticket**: BL-571 `rotation sequential` packs are invisible to ensure's declared signal
- **Reviewed commit**: `bbb14382d8` (from cleaner), merged into architect as `HEAD`
- **Reviewer**: architect, 2026-08-19
- **Verdict**: BOUNCE to **coder** — one defect (D1). Everything else on the checklist is CLEAN.
- **Prior bounces on this ticket**: none (checked `main` and `origin/main`; local `main`
  is 13 ahead of `origin/main`, so `main` is the fresher ref and was read).

This is one bounce for the whole review pass. The pass was completed to the end —
D1 did not stop it. No check is BLOCKED; every item below was run or is recorded
with the evidence that made it a pass.

---

## D1 — the new single-resident value set is a hand-mirrored constant across a language boundary, with no gate

- **Class**: `behavior`
- **Blamed role**: `coder`
- **Site**: `swarmforge/scripts/mono_router_lib.bb:73-76` (`single-resident-rotation-values`)
- **Rule**: constitution → Engineering Rules → *Guardrails* (BL-897):
  > A constant mirrored by hand across a language boundary no import can bridge
  > (here TS ↔ Babashka) needs a test asserting both literals agree — a "kept in
  > sync" comment is not a gate, and drift fails silently.

### What the parcel does

The parcel introduces a new constant whose *stated contract* is equality with a
literal set that lives in another language:

```clojure
(def ^:private single-resident-rotation-values
  "Every rotation value swarmforge.sh's is_sequential_dormant treats as the
   single-resident topology. Widen this ONLY alongside the launcher."
  ["router" "sequential"])
```

The other side of the mirror is bash, in `swarmforge/scripts/swarmforge.sh:716`:

```bash
is_sequential_dormant() {
  ...
  [[ "$ROTATION_MODE" == "sequential" || "$ROTATION_MODE" == "router" ]] || return 1
```

Nothing can import across bash ↔ Babashka. The only thing holding the two sets
equal is the docstring sentence "Widen this ONLY alongside the launcher" — which
is exactly the "kept in sync comment" the guardrail names as not-a-gate.

### Proof the drift is silent

Grepped for any test that relates the two literal sets:

- `grep -rn "is_sequential_dormant" swarmforge/scripts/test/ specs/ extension/` →
  only `test_rotation_sequential_pack.sh` (BL-448) and comments.
- `test_rotation_sequential_pack.sh` sources `swarmforge.sh` and calls
  `is_sequential_dormant` — but only under a fixture declaring
  `config rotation sequential`, asserting *index* dormancy (`DORMANT:2..4`,
  `RESIDENT:1`, `RESIDENT:last`). It never sweeps the accepted **value set**.
- `grep -rn "single-resident-rotation-values"` → three hits, all inside
  `mono_router_lib.bb` itself. No test names it.

So **no test fails** if the two sets diverge, in either direction:

| Drift | Consequence | Caught by any test today? |
|---|---|---|
| A third value added to `is_sequential_dormant` (e.g. `rotate`) and not to `single-resident-rotation-values` | `./swarm ensure` respawns the five middle roles on that pack — **BL-571's own defect, silently reintroduced**, on the memory-constrained host the ticket says has already OOM-crashed | **No** |
| `single-resident-rotation-values` widened without the launcher | ensure classifies genuinely broken panes as DORMANT and stops healing them — the BL-530-round-3 regression this ticket explicitly fences off | **No** (the classic-pack guard only covers *no rotation line*, not a new named value) |

The first row is the one that matters: this ticket exists *because* the two sides
already drifted once. Shipping the fix without a gate leaves the same drift free
to happen again, in the same silent way, with the same blast radius.

### Remediation (coder)

Add a parity test under `swarmforge/scripts/test/` that derives the launcher's
accepted set from `swarmforge.sh` itself and asserts **set equality** with
`mono_router_lib.bb`'s `single-resident-rotation-values` — failing on a
difference in **either** direction.

The mechanism already exists and can be copied: `test_rotation_sequential_pack.sh`
already sources `swarmforge.sh` under `zsh` (the `ZSH_EVAL_CONTEXT` guard skips
the top-level launch body) and calls `is_sequential_dormant` directly. Sweep
`ROTATION_MODE` over the candidate values instead of pinning one, and compare the
resulting accepted set against the Babashka constant (read out with
`bb -e '(load-file …) (println …)'`, the same way
`bl571SequentialRotationDormantParitySteps.js` already shells to `bb -e`).

Prove it non-vacuous both ways, per the same break-then-fix discipline used
elsewhere in this parcel: add a value to the bash side only → test must FAIL;
add it to the Babashka side only → test must FAIL; restore.

---

## Checklist — every item run, none blocked

| # | Check | Result |
|---|---|---|
| 1 | Lineage: `git merge-base --is-ancestor bbb14382d8 HEAD` | **PASS** |
| 2 | Content parity vs sender tip (`git diff bbb14382d8 HEAD -- <paths>`) | **PASS** — empty; merge dropped nothing (BL-954 check) |
| 3 | Prior-bounce history read from a `main` ref (BL-340, BL-891) | **PASS** — none; `main` 13 ahead of `origin/main`, read `main` |
| 4 | **Dependency-rule gate (BL-259, hard gate)** | **PASS for this parcel** — see below |
| 5 | Co-change / logical coupling (BL-255) | **RUN** — see below; feeds D1 |
| 6 | Declared invariant: property test EXISTS | **PASS** — `swarmforge/scripts/test/bl571_single_resident_rotation_property_runner.bb` |
| 7 | Declared invariant: property test NON-VACUOUS | **PASS** — proven by me, both directions (below) |
| 8 | Declared invariant: violation sweep across the parcel | **PASS** — no site violates it |
| 9 | Architecture: purity of `mono_router_lib.bb` preserved, IO at the edge | **PASS** |
| 10 | Architecture: two-layer / webview storage / secrets / integrate-not-fork | **PASS** (n/a surfaces untouched; `swarmforge/` edits are the sanctioned maintained fork) |
| 11 | Scope (An Approval Authorizes Only Its Ticket's Work) | **PASS** — only the sanctioned call site widened |
| 12 | No half-widened second gate inside `swarm_ensure.bb` | **PASS** |
| 13 | Fixture cleanup discipline for `mkdtempSync` | **PASS** — `afterEach` + `trackedRoots` |
| 14 | `bb mono_router_lib_test_runner.bb` | **PASS** — `ok` |
| 15 | `bb bl571_single_resident_rotation_property_runner.bb` | **PASS** — 500 runs / 246 pos / 120 seq / 254 neg |
| 16 | `bash test_swarm_ensure.sh` (full suite) | **PASS** — 45 pass / 0 fail / exit 0, including the new BL-571 sequential case |
| 17 | Acceptance: `run_acceptance.sh BL-571-…feature` | **PASS** — 4 tests, 4 pass, 0 fail, exit 0 |
| 18 | Undeclared-property coverage on touched pure modules | **PASS** — already covered; nothing to add |

### 4 — dependency-rule gate

Run against the parcel's changed files and again as a full-repo scan. The only
edges reported are a **pre-existing** cycle:

```
src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts     violates "acyclic"
src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
```

Not attributable to this parcel: `git diff --name-only 58632c322 bbb14382d8 -- extension/`
is **empty** — BL-571 changed zero files under `extension/`. The cycle was
introduced by `bdab5ce61` (BL-620) and is already tracked as
`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
No forbidden edge belongs to BL-571, so this is not a bounce item.

### 5 — co-change (logical coupling)

`mono_router_lib.bb` ranks, among others:

```
swarmforge/scripts/test/mono_router_lib_test_runner.bb : 19  (SUSPECTED COUPLING)
swarmforge/scripts/handoffd.bb                        : 10  (SUSPECTED COUPLING)
swarmforge/scripts/handoff_lib.bb                     :  5  (SUSPECTED COUPLING)
swarmforge/scripts/swarm_ensure.bb                    :  4  (SUSPECTED COUPLING)
swarmforge/scripts/swarmforge.sh                      :  4  (SUSPECTED COUPLING)
```

The `handoffd`/`handoff_lib`/`swarm_ensure` rows are the six-site predicate
duplication the ticket already names as deliberately out of scope — correctly left
alone here. The **`swarmforge.sh` row is the one that matters**: it is the
launcher↔library coupling that no import expresses, and it is precisely what D1 is
about. The tool informs only; the judgment is mine, and it is D1.

### 7 — non-vacuity of the declared invariant's property test (proven, not accepted on the author's word)

The runner asserts its own non-vacuity in a comment. I re-proved it against the
live code, then restored (`git diff` back to 0 lines both times):

- **Break A** — narrow `single-resident-rotation-values` to `["router"]`:
  property runner exits **1** with 240 failures
  (`FAIL: launcher-accepted conf not recognised: "…rotation sequential"`);
  `mono_router_lib_test_runner.bb` exits **1**.
- **Break B** — widen the conf regex to any value (`\S+`):
  property runner exits **1** with 254 failures, including the ROTATE_HOME fence row
  (`FAIL fence: router-only predicate widened to sequential`);
  `mono_router_lib_test_runner.bb` exits **1** on both the word-boundary case and the
  `conf-rotation-router? still rejects sequential` pin.

The test bites in both directions. The declared invariant is genuinely encoded, and
the runner's own stated decomposition — predicate parity generated here, the
"ensure never respawns" tail asserted end-to-end by `test_swarm_ensure.sh`'s
empty-respawn-log fixtures for BOTH values — is accurate: I confirmed the sequential
twin fixture exists and passes.

---

## What was RIGHT in this parcel (recorded so the re-fix does not disturb it)

- The refactor is behavior-preserving on the router-only side, and the parcel
  **pins** that with dedicated tests (`conf-rotation-router? still rejects
  sequential`, `rotation-router-from-identity? still rejects sequential`).
- The ROTATE_HOME fence is honored exactly: `ready_for_next_task.bb`,
  `ready_for_next_batch.bb`, `handoffd.bb`, `swarm_status.bb`,
  `babysitter_check.bb` and `resolve-rotation-router-mode?` all still consume the
  router-only predicates. Scenario 03 asserts the backstop does not fire.
- All four "things that MOVED" in the ticket's re-read note were handled — in
  particular note 2: both the shell fixture and the step-handler fixture stand up a
  live resident pane *and* a per-role launch script, so BL-537's
  `dormant-rotate-viable?` gate yields `:dormant` rather than `:failed`.
- Scenario 01's Given honors the **captured** `<rotation>` value rather than
  hard-coding one, as the ticket's shared-cell-mutation warning demanded.

**Fix D1 only.** Do not widen `conf-rotation-router?`,
`resolve-rotation-router-mode?`, or any other call site.

---

## Routed elsewhere in this same pass (NOT a second bounce)

**S1 — spec-gap → `note` (priority `00`) to specifier + coordinator.**
The ticket's `qa_e2e_procedure` lists `test_swarm_ensure.sh` and
`mono_router_lib_test_runner.bb`, but not
`bl571_single_resident_rotation_property_runner.bb` — the property test encoding the
ticket's one declared invariant. Followed literally, the QA gate never runs it. The
repo convention is to list it (e.g. `backlog/done/M8/BL-806-…yaml` names its property
runner explicitly under "Invariants (both declared, BL-654)"; BL-872, BL-936, BL-853
likewise). Specifier-owned, one line in the ticket YAML.

**S2 — informational → coordinator.**
BL-759 (paused) red-lines the architect's *required hard gate*: `dependency-gate.js`
exits non-zero on every parcel until that cycle is broken, so the gate cannot be used
as a pass/fail signal by any reviewer. Flagging as a prioritization datum only — it is
already ticketed and is not a BL-571 item.

---

## D1 remediation (coder, 2026-08-19, pass 1 re-fix)

Parity gate added to `swarmforge/scripts/test/mono_router_lib_test_runner.bb`
(the runner the ticket's qa_e2e already names): derives the launcher's
accepted set from `swarmforge.sh` itself (the `is_sequential_dormant` body's
own `"$ROTATION_MODE" == "<value>"` literals), asserts SET EQUALITY with
`single-resident-rotation-values`, then functionally confirms each derived
value against the real sourced launcher function (and rejects a control
value) so the textual derivation cannot rot into matching nothing.
Non-vacuity proven in BOTH directions and restored: `rotate` added to the
bash side only -> gate FAILED; `rotate` added to the Babashka side only ->
gate FAILED. Parcel content otherwise untouched (kept at the reviewed
cleaner tip `bbb14382d8`, byte-verified per file at merge).
