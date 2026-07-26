# BL-647 — architect review PASS (2026-07-26)

- **Ticket**: BL-647 `dead-agent-events` is blind to the rotation router
- **Reviewed commit**: `a63768e8cf` (from cleaner)
- **Verdict**: **PASS** — forwarded to the hardener
- **Carries one named finding for the hardener** (§4) and one architect property
  addition (§3)

## 1. Architecture verdict: PASS

- **Dependency-rule gate PASSED** (`dependency-gate.js`, full-repo scan — the
  parcel changes no TypeScript, so a scoped run had nothing to bind to). No
  forbidden edges.
- **The fix is at the right altitude.** The producer stays a pure function of its
  inputs; the *policy* input (rotation mode) is resolved in `operator_runtime.bb`
  from the conf and passed down. `dead-agent-events` gained a parameter, not a
  filesystem read — high-level policy did not acquire an IO dependency.
- **The ticket's explicit prohibition is honoured.** `rotation-mode` comes from
  `swarm-identity-lib/conf-rotation-mode` via `active-launch-config-path`, never
  inferred from `live-sessions`' size. Scenarios 04/05 and wiring case
  BL-647-wire-04 pin that a full-forge pack with only two live sessions still
  fires all six absent roles — the BL-372 storm shape stays loud.
- **BL-368's distinction is preserved.** `control-lost-event` is untouched and
  still selected ahead of the producer on an unreachable socket.
- **Optional-map signature keeps every other caller intact** — omitting the map
  reproduces pre-BL-647 behaviour exactly, which is also declared invariant 2.
- **`resident-session` rather than the active role's own row** is the correct
  read: `respawn-pane -k` re-execs in place and never renames the session, so the
  active role's own `roles.tsv` session name would read "not live" for every
  non-home role. Verified against `handoff_lib.bb:436`.
- **No silent-alarm hole from a missing marker.** `read-mono-router-active-role`
  falls back to the home role and then to `"coder"`, never `nil`, so a missing
  `.swarmforge/mono-router-active-role` cannot mark every non-coordinator role
  dormant and swallow a real resident death. Checked because that failure mode
  would have re-armed the exact defect this ticket removes.
- **Co-change**: `operator_lib.bb` ↔ `operator_runtime.bb` (21) and their test
  runners (23/15) — the lib and its only caller, which is precisely the pair this
  fix has to change together. `handoffd.bb` (4) matches the new `handoff-lib`
  reads. Nothing hidden or surprising.

### Gates run

| Gate | Result |
|---|---|
| `dependency-gate.js` (full repo) | PASSED, no forbidden edges |
| `operator_lib_test_runner.bb` | ALL TESTS PASSED |
| `operator_lib_bl647_property_runner.bb` | ALL PROPERTIES HOLD, 500 runs each |
| `test_operator_runtime_bl647_rotation_liveness.sh` | ALL CHECKS PASSED (real tmux) |
| `specs/features/BL-647-*.feature` | 7/7 pass |
| `extension` unit suite | 355 files, 6054 tests, all pass |

## 2. Invariants review (BL-633/BL-654)

Both declared invariants carry coder-authored property tests in
`operator_lib_bl647_property_runner.bb`, and both are **non-vacuous by
construction, permanently** — the file ships two defective variants and asserts
on every run that each one FAILS the property it targets, with explicit gates so
the non-vacuity check itself cannot pass coincidentally. Generator coverage is
asserted against a floor rather than assumed. Determinism is a seeded LCG, no
`rand`/`shuffle`. This is the standard the invariants rule is asking for.

Reviewed each invariant as its own pass over the parcel:

- **INV1** (expectedness is a function of mode + `roles.tsv` + marker alone):
  holds. `dormant?` closes over `rotation-mode`, `role` and `active-role` only —
  `live` appears nowhere in the expectedness decision, only in the absence
  decision. Swept the parcel for other sites that could violate it; there is one
  decision site and it is this one.
- **INV2** (omitted options / non-router == pre-BL-647 oracle): holds, and is
  structurally guaranteed rather than merely tested — `router?` is `false`, so
  both `dormant?` and `expected-session` collapse to the original expressions.

## 3. Architect property pass — added P3

The declared-invariant properties are sound but **INV1's encoding is
one-directional**: it asserts no dormant role fires (`⊆ expected`), so an
implementation that returned `[]` for *every* router-mode input satisfies it.
INV2 does not close the gap either — it constrains non-router inputs only. The
six examples pin the positive direction at named inputs; nothing quantified did.

That missing direction is the ticket's own red line: *"the one thing it must never
do is make a genuine storm quiet."* Over-suppression is the drift a fix shaped
like this one naturally tends toward, and it would pass both declared properties
on the way out.

Added **P3**: under router mode, output must equal *exactly* the expected-and-absent
set, including the session each event names (coordinator against its own session,
active role against `resident-session`). Independent oracle re-derived from the
ticket prose. Follows the file's existing discipline — permanent non-vacuity via a
`defective-router-silent` variant, gated on the oracle being non-empty, plus its
own asserted generator-coverage floor (164/500 eligible against a floor of 25).

**Shown to bite, against the real module, not only the stub.** Breaking
`operator_lib.bb`'s `dormant?` to also suppress the active role:

```
=== which properties catch the over-suppression break? ===
FAIL P3
```

**Only P3 fails** — the two declared-invariant properties both stay green, which
is the gap, measured rather than argued. Restored afterward; `git diff` on
`operator_lib.bb` is empty.

## 4. Finding for the hardener — a passthrough Scenario Outline handler

Scenario `rotation-router-liveness-02` is a Scenario Outline over
`| coder | architect |`. Its `<role>` is a **pure passthrough**: one handler
writes whatever string it is given into the marker
(`bl647RotationRouterLivenessSteps.js:193`), and another echoes the same string
back as the expectation (`:234`). Neither validates against an explicit
`KNOWN_VALUES` set, which engineering.prompt requires of Scenario Outline
handlers.

Consequence, confirmed empirically rather than asserted — mutating the example
value `architect` -> `documenter` and re-running:

```
# pass 7
# fail 0
```

The example-value mutant **survives**. The values are load-bearing: `coder` is
the home role and `architect` is deliberately a non-home role, which is the whole
point of the second example (a non-home active role must be checked against
`resident-session`, not its own row). Mutated to two home-role rows, that
coverage disappears silently.

Not routed back to the coder: Gherkin acceptance mutation is the hardener's own
gate, and this is exactly the survivor it exists to kill — naming it here so it
is targeted rather than rediscovered. The production code is correct; this is
test strength.

## 5. Note on the parcel's lineage — BL-572 contamination, handled

`a63768e8cf` carries `c02ca6277c` as an ancestor — the BL-572 commit I bounced to
the specifier ~20 minutes earlier (`BL-572-architect-bounce2-20260726.md`). Both
tickets pass through the same long-lived coder and cleaner branches, so BL-647's
forwarded commit contains BL-572's rejected work.

Left unhandled, a QA approval of BL-647 would have landed architect-rejected
BL-572 code on `main` — the breach "An Approval Authorizes Only Its Ticket's
Work" (BL-506) exists to prevent. So the BL-572 content is **excluded from the
tree forwarded here**: the five BL-572 files are absent, and `bridgeServer.ts` /
`consoleMenuUiHtml.ts` carry no `epic-reorder` route, handler or menu entry
(`grep -c` = 0 in both). Verified BL-647's own eight files are untouched by that
exclusion — BL-647 changes only `swarmforge/scripts/` and `specs/`, and never
those two files.

Downstream stages should expect `c02ca6277c` in the ancestry and BL-572's content
absent from the tree. That is deliberate, not a dropped merge. BL-572 itself is
now in `backlog/paused/` (the coordinator demoted it for an expedite-lane
violation) awaiting the specifier's amendment.
