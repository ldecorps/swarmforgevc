# BL-958 — architect review pass 1: complete inventory

- **Ticket**: BL-958 full-forge tmux control-plane crash root cause (`type: defect`, `severity: high`)
- **Commit reviewed**: `ec033029e2` (cleaner) — merged as `91c3c96ba`
- **Reviewer**: architect, 2026-08-19
- **Verdict**: BOUNCE to coder — 1 defect (D1). One `spec-gap` item (S1) leaves
  separately as a `note`; it is not a second bounce.

Article 4.4: the full checklist was run before sending. Nothing below was cut
short at the first defect.

---

## D1 — `recovery-decision`'s `:action` is inert; `:halt` reports FIXED and destroys the incident

- **Class**: `behavior`
- **Blamed role**: coder
- **Declared invariant violated**: #2 — *"A missing tmux server cannot leave the
  system in a half-alive state indefinitely; either controlled auto-recovery
  occurs or a single actionable incident is emitted with root-cause evidence."*

### What is wrong

`control_plane_lib/recovery-decision` returns `{:action :halt}` when the
classification is `:control-plane-missing` **and** no persisted launch scripts
exist. Its docstring promises `:halt` means *"recreation is impossible, report
loudly instead of churning"*.

`swarm_ensure.bb` never branches on that `:action`. Only the decision's
`:reason` **string** is consumed, pasted into the report text:

- `swarm_ensure.bb` `-main`: `role-results` is gated on `socket` alone, never on
  `(:decision cp-state)`, so the per-role repair loop runs under `:halt` too.
- `ensure-standing-role!` (`swarm_ensure.bb:226`) calls `create-session!`
  unconditionally when the session is missing; `create-session!` runs
  `tmux new-session`, which **restarts the tmux server**.
- `control-plane-report!` then re-probes, sees a responding server, reports
  **FIXED**, and calls `resolve-open-incidents!`.

Grep confirms the inertness — `:relaunch-roles`/`:halt` appear in
`control_plane_lib.bb` (definition) and in a `swarm_ensure.bb` *docstring*, and
nowhere else in production code.

### Reproduction (run, not reasoned)

Identical to the parcel's own `test_swarm_ensure.sh` BL-958 fixture, except the
launch script is omitted so `launch-scripts-present?` is false:

```
make_fixture
rm -f "$ROOT/.swarmforge/launch/"*.sh          # -> recovery-decision = :halt
printf 'swarmforge-coder\t123\n' > "$ROOT/.swarmforge/sessions.tsv"
# incidents/control-plane.json seeded with one OPEN incident
# stateful fake tmux: new-session starts the server; respawn-pane exits 1
run_ensure
```

Observed output:

```
agent:coder: FIXED (respawned pane from its persisted launch script)
control-plane: FIXED (control-plane-missing: no persisted launch scripts to respawn roles from; tmux server restored)
```

and the incident store afterwards:

```json
{ "classification": "control-plane-missing", ..., "status": "resolved",
  "resolved-at": "2026-08-19T20:11:40.849577Z" }
```

### Why this matters

Three separate failures in one report:

1. **A self-contradictory verdict.** `control-plane: FIXED (… no persisted
   launch scripts to respawn roles from …)` — the reason states recovery was
   impossible while the status claims success.
2. **A false agent verdict.** `agent:coder: FIXED (respawned pane from its
   persisted launch script)` when no such script exists and `respawn-pane`
   failed. BL-958 introduced this by swapping `respawn-role!` for
   `ensure-standing-role!` on the standing path: `create-session!` leaves a bare
   shell whose pane reads alive, so the canned action string is emitted as a
   verified repair. Before this parcel the missing session made the row FAILED.
3. **The evidence is deleted.** The single actionable incident — the artifact
   this whole ticket exists to produce, per invariant 2 and
   `qa_e2e_procedure` step 6 — is stamped `resolved` while every role is dead.

Net effect: BL-958 replaces the original misdiagnosis (per-role DOWN, no
control-plane row) with a worse one (control-plane FIXED, incident closed, no
agents running). The half-alive state invariant 2 forbids is exactly what is
left behind, now with the evidence destroyed.

The structural separation in `control_plane_lib.bb` is right — pure decisions
above, IO edge below. The defect is that the adapter does not obey the policy it
just computed.

### Remediation

- Branch on `(:action (:decision cp-state))` in `swarm_ensure.bb` `-main`:
  under `:halt`, skip the per-role recreation loop rather than churning.
- Under `:halt`, `control-plane-report!` must report **FAILED** (or escalate per
  `response-policy`) and must **not** call `resolve-open-incidents!`. Resolving
  an incident should require a recovery that actually restored roles, not merely
  a tmux server that answers.
- Consider having ensure consume `response-policy` for the no-scripts state, so
  the escalate branch (`:reason` + `:next-action`) reaches an operator instead of
  being reachable only through handoffd's chase hook.
- Add the missing ensure-level coverage: the parcel's fixture creates
  `launch/coder.sh` and therefore only ever exercises `:relaunch-roles`. The
  `:halt` state has no ensure-level test, which is why this shipped.

---

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`merge-base --is-ancestor ec033029e2 HEAD`) | PASS |
| 2 | Bounced-BL-571 content kept out of the merge (BL-954 re-application check) | PASS — conflicts resolved to admit BL-958 only; every BL-958 file byte-identical to sender tip |
| 3 | All 7 `mono_router_lib` fns called by `swarm_ensure.bb` survive the BL-571 revert | PASS |
| 4 | **Dependency gate (hard gate)** on parcel files | PASS for this parcel — only the pre-existing BL-759 `telegram-*` `acyclic` cycle reported; no parcel file is in it |
| 5 | Co-change coupling report | PASS — flags the `swarm_ensure`/`swarm_status`/`handoffd` triad, which is precisely the hand-copy coupling this parcel's shared lib removes |
| 6 | Two-layer boundary (view vs tmux substrate) | PASS — no agent process spawned from TypeScript |
| 7 | Extension host owns I/O / no webview storage | N/A — no extension or webview code touched |
| 8 | Secrets never written to the target tree | PASS — only the identifier `classification-token` matches |
| 9 | Policy independent of IO/UI/filesystem | PASS structurally (pure decisions above, IO edge below) — but see D1: the adapter ignores the policy |
| 10 | Dependency direction / no new cycles | PASS — three consumers depend inward on one new lib |
| 11 | `required_wiring` entries resolve (BL-874 trap) | PASS — all three paths carry the literal `control_plane_lib` on a real `load-file` line |
| 12 | Invariant 1 — explicit control-plane failure | PASS — encoded + non-vacuous; `classify`'s full truth table (`:up`, `:control-plane-missing`, three `:down` shapes) is pinned in `control_plane_lib_test_runner.bb`, so an always-loss mutant dies |
| 13 | Invariant 2 — no indefinite half-alive state | **FAIL — D1** |
| 14 | Invariant 3 — health from live truth, not stale metadata | PASS — `status-agents-view` replaces per-role rows; property asserts two independent stale draws yield an identical view |
| 15 | Invariant 4 — exactly one deterministic owner | PASS — `response-policy` reached in production via `record-chase-failure-incident!`, embedded in the incident's `:response` |
| 16 | Property tests exist + non-vacuous for all 4 declared invariants | PASS — `bl958_control_plane_property_runner.bb`, 400 runs, with asserted reachability floors (400 loss / 400 bursts / 193 resolved-then-new / 201 no-scripts) |
| 17 | Mirrored token `"control-plane-missing"` has a drift gate (BL-897 class) | PASS — pinned independently in `control_plane_lib_test_runner:50` and `swarm_status_lib_test_runner:117`; either drift goes red |
| 18 | `control_plane_lib_test_runner.bb` | PASS |
| 19 | `bl958_control_plane_property_runner.bb` | PASS (400 runs) |
| 20 | `swarm_status_lib_test_runner.bb` | PASS |
| 21 | `test_swarm_ensure.sh` (incl. the BL-958 case, after my conflict resolution) | PASS — ALL PASS, 45 cases, 0 failures, BL-958 case green (run against the reviewed merge 91c3c96ba, before the bounce revert) |
| 22 | Architect property-coverage pass (undeclared properties, touched pure modules) | No new property required — `control_plane_lib`'s pure surface is already covered for all four invariants with reachability floors. Optional (not a defect): `resolve-incidents` idempotence is unencoded. |

## S1 — spec gap (leaves as a `note`, not a bounce)

The ticket's `verification` step 3 ("`./swarm ensure .` must restore full-forge
role sessions") and `qa_e2e_procedure` step 5 ("auto-recover **or** one
escalation") both describe the no-recovery-possible branch, but no acceptance
scenario covers it — the three Gherkin scenarios cover status classification,
chase-incident persistence, and policy ownership only. The `:halt` state is
therefore ungated at the acceptance level, which is how D1 reached review. The
specifier may want a fourth scenario pinning ensure's behaviour when recovery is
impossible.

---

## D1 remediation (coder, 2026-08-19, pass 1 re-fix)

The recovery decision now GATES both the loop and the report in
`swarm_ensure.bb`:

- `-main` computes `halt?` from `(:action (:decision cp-state))`; under
  `:halt` the per-role recreation loop does not run at all (each agent row
  reports FAILED with "recreation skipped", rc rows pass through healthy) —
  `create-session!` can no longer restart a bare tmux server as a side
  effect of churning.
- `control-plane-report!` branches on the action: under `:halt` it never
  probes, reports FAILED carrying the decision reason PLUS
  `response-policy`'s own `:next-action` (the escalate branch now reaches
  the operator through ensure, not only handoffd's chase hook), and never
  calls `resolve-open-incidents!` — resolution requires an actual recovery.
- Ensure-level coverage added: `test_swarm_ensure.sh` gains the :halt twin
  of the parcel's own BL-958 fixture (launch scripts removed, open incident
  seeded, stateful fake tmux) asserting FAILED + no-scripts reason +
  escalation text, server marker absent (no recreation), no ": FIXED" row,
  incident still open and never resolved.
- S1 (specifier's scenario control-plane-loss-04) rides this parcel per
  BL-233: step handlers added in `bl958ControlPlaneLossSteps.js` (scenario
  04 red against the unfixed code — control-plane FIXED, incident resolved
  — then green after the fix; scenarios 01-03 green throughout).
