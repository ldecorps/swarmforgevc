# BL-957 — architect review pass 1: complete inventory

- **Ticket**: BL-957 promotion gate refuses unsatisfied depends_on (`type: defect`, `severity: high`)
- **Commit reviewed**: `1521d68c38` (cleaner)
- **Reviewer**: architect, 2026-08-20
- **Prior bounces**: none — first architect pass on this ticket
- **Verdict**: **PASS — defects found: NONE.** One spec-gap item leaves as a `note`
  (S1 below), which per Article 4.4 is not a bounce.

## Both declared invariants are encoded, and I broke them myself to prove it

Per the Invariants Review, existence and non-vacuity come before any hand-verification.
Both invariants carry coder-authored property tests (P11, P12), and the runner asserts
generator reachability rather than hoping for it:

```
generator coverage: P11 refuse=322 allow=178 block-form=137 unparseable=111
promotion_gates_lib properties: 500 runs each
ALL PROPERTIES HOLD
```

The block form matters most — it is the `read-field` fail-open trap the ticket was
written around — and it is genuinely reached 137/500 times.

The file states its non-vacuity was proven at authoring time. I did not take that on
trust; I reproduced both breaks in a scratch copy of the whole `scripts/` tree:

| break applied | result |
|---|---|
| `depends-on-refusal` dropped from `evaluate`'s `or` chain | **637 failures — P11 and P12 both** |
| `read-depends-on` made to treat a blank inline value as absent (i.e. `read-field`'s documented blank→nil rule, reinstating the fail-open trap) | **158 failures — P11 and P12 both** |

A note on reading that output: the runner prints only `(take 10 @failures)`, and under
break 1 all ten happened to be P11 — which looks exactly like P12 being vacuous. It is
not. Patching the reporter to print distinct property names showed both fail under both
breaks. Worth recording because the truncated view is genuinely misleading.

Scratch tree removed; the worktree was never modified.

**Invariant 1's "any route added later" clause** is correctly recorded as
non-encodable (the coder role's own carve-out) — no test can run a route that does not
exist yet — with the structural reason stated instead: BL-663's chokepoint, one
`evaluate` call site per CLI mode. I verified that structural claim rather than
accepting it: the only production paths that move a ticket `paused → active` are
`promote_and_route_next.sh` (by-name via `locate`+`evaluate`, auto-pick via `select`),
and both CLI modes now pass `:done-ids`. `route_backlog_to_coder.sh` operates on
already-active items and never promotes; `issue_specced.sh` only writes into `paused/`.
`chase_sweep_lib.bb` uses `rank-candidates` but cannot promote — see S1.

Also worth noting the fail-closed default: `evaluate` reads `(or done-id-set #{})`, so a
future route that forgets to pass `:done-ids` refuses every dependent ticket rather than
promoting it. The failure mode of omission points the safe way.

## Verified against the live backlog, not only fixtures

- **The fail-open trap, live** — `evaluate` on the real block-form ticket BL-557:
  `REFUSE|depends_on|depends_on not yet landed in backlog/done/: BL-556`, exit 2.
  It names **only** BL-556, not BL-547, because **BL-547 has since landed** in
  `backlog/done/`. That is exactly right (name every unsatisfied id, never a satisfied
  one) — but the ticket's `qa_e2e_procedure` step 3 still expects both ids, written
  before BL-547 landed. **Flagged for QA so a correct result is not read as a failure.**
- **`done/<Mx>/` recursion** — `done-ids` returns 727 ids; BL-547 (flat file) and
  BL-956/BL-827 (both under `done/M8/`) all resolve, while still-paused BL-556 does not.
- **No regression from the chain insertion.** Placing a gate before `depth` can change
  which gate wins for a ticket failing both, so I ran BL-663's own chokepoint feature:
  **8/8 pass**. Its fixtures declare no `depends_on` (0 references), so they pass
  straight through the new link — the mechanism, not just the outcome.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`1521d68c38` ancestor of HEAD) | PASS |
| 2 | Registry conflict-free; union preserved | PASS — `bl571`+`bl958`+`bl960`+`bl957`, all four files present, registry loads |
| 3 | **Re-fix/merge not silently reverting sibling content (BL-954 trap)** | PASS — merged tree byte-identical to sender's tip across `swarmforge/`, `specs/`, `extension/` |
| 4 | Prior QA/architect bounce on this ticket still unfixed | PASS — none; first pass (checked `main`, which is 2 ahead / 0 behind `origin/main`) |
| 5 | Ticket promotion provenance | PASS — `fab2110e5`, a separate coordinator commit, not the coder activating its own ticket |
| 6 | **Invariant 1 — every promotion route decides through `evaluate`** | PASS — P12 + verified route census; non-encodable clause correctly reasoned, not silently skipped |
| 7 | **Invariant 2 — fails closed on unresolvable/unparseable ids** | PASS — P11; and the `(or done-id-set #{})` default fails closed too |
| 8 | **Property tests exist AND are non-vacuous** | PASS — both breaks reproduced by me, both properties bite |
| 9 | Chain placement (after `human_approval`, before `depth`) | PASS — asserted in BOTH directions in the unit runner, plus the pass-through case |
| 10 | Existing gates unweakened / first-failing-gate-wins intact | PASS — BL-663 acceptance 8/8; no gate reordered |
| 11 | Check not reimplemented in `promote_and_route_next.sh` (ticket constraint) | PASS — the script is deliberately unchanged; it inherits the gate through the chokepoint |
| 12 | Refusal names the unsatisfied ids | PASS — unit, property, and live BL-557 |
| 13 | `promotion_gates_lib_test_runner.bb` | PASS — ALL PASS |
| 14 | `promotion_gates_lib_property_runner.bb` | PASS — ALL PROPERTIES HOLD, 500 runs each, reachability asserted |
| 15 | `promotion_gates_cli_test_runner.bb` | PASS — ALL PASS |
| 16 | `test_promote_and_route_next_priority.sh` | PASS |
| 17 | `test_promote_and_route_next_no_limit_depth.sh` | PASS |
| 18 | Acceptance: BL-957 feature | PASS — **15/15**, driving the REAL CLI and REAL promote script in a temp fixture root, not a reimplementation |
| 19 | Acceptance: BL-663 chokepoint (regression) | PASS — 8/8 |
| 20 | Scenario Outline validated against explicit KNOWN_VALUES | PASS — four KNOWN maps, each throwing by name on an unrecognized cell |
| 21 | Fixture cleanup discipline (2026-08-18 leak lesson) | PASS — `afterEach` drains a tracked-roots stack unconditionally; env allowlisted |
| 22 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable** — BL-759's pre-existing telegram cycle; zero telegram files in this parcel |
| 23 | Co-change coupling | Informational — coupled set moved together; the one unmoved partner is unmoved *by design* (see 11) |
| 24 | Policy independent of IO/UI/filesystem | PASS — and improved: the cleaner moved `done-ids` out of the pure half into the file's declared impure half, so `depends-on-refusal` takes a plain id set and stays pure |
| 25 | Two-layer boundary / secrets / host owns I/O / no webview storage | PASS — swarm machinery only, no extension or webview code |
| 26 | Architect property-coverage pass (undeclared properties) | No new property required — see below |

### Check 26 — why I am adding no property

The touched pure surface is `read-depends-on`, `depends-on-refusal` and `evaluate`.
P11 already quantifies the first two across all four live field forms plus the
unparseable sibling. The remaining untested-by-property decision is the **chain
ordering**, and that is a three-case decision, not a property-shaped input space — it is
already pinned by explicit unit assertions in both directions. Manufacturing a property
over three fixed cases would add ceremony, not power. Saying so explicitly, per the
role's instruction not to invent a vacuous property.

### Check 22 — attribution

Full-repo `dependency-gate.js` exits 1 on three `acyclic` edges among
`src/tools/telegram*`. This parcel touches zero telegram files; the cycle is ticketed as
**BL-759** (`backlog/paused/`). Pre-existing, owned, not this parcel's — not a bounce.

## Observations for the stages after me (neither a defect nor a bounce)

- **Prose shadowing of the field (robustness, for the hardener).** `read-depends-on`
  takes the FIRST line whose trimmed form starts with `depends_on:`. A ticket whose prose
  contained such a line *before* the real field would be misread — and in the specific
  shape `depends_on: []` appearing in prose, it would fail **open**. I measured every
  ticket in `paused/`, `hold/` and `active/`: **zero** instances today, and BL-957's own
  YAML (whose description quotes a block-form example) is safe because the real field
  comes first. Theoretical now; cheap to harden by anchoring at column 0.
- **Stale `qa_e2e` step 3** — see above; BL-547 has landed, so the correct output names
  only BL-556.

## S1 (spec gap) — the open-slot nudge cannot see the new gate

**Leaving as a `note` (priority `00`) to specifier and coordinator in this same pass —
not a bounce, and not a defect in this parcel's code.**

BL-798's open-slot nudge names the top Article-3.2.4 paused candidate to the
coordinator, and escalates after 3 unacted nudges for the SAME candidate.
`read-paused-candidates` collects **every** `backlog/paused/*.yaml` with no gate filter,
and `top-open-slot-candidate` ranks them all. It therefore cannot see the depends_on
refusal, so it can name a candidate that promotion will now refuse, repeat, and escalate
on a ticket that is correctly blocked.

This does **not** violate invariant 1 — the nudge is not a promotion route and cannot
promote — which is why it is a spec gap rather than a defect. Note the existing design
precedent pointing at the answer: `top-open-slot-candidate` already reports `:approved?`
so a human_approval-blocked candidate is *named but flagged* (BL-798 scenario 03) rather
than silently skipped. depends_on has no equivalent flag.

Measured on the live backlog today so it can be sized rather than guessed:
**23 of 166 paused candidates are depends_on-blocked**, but the top six by ranking
(BL-543, BL-101, BL-865, BL-770, BL-824, BL-818) are all promotable. So the loop is
**latent, not firing** — it becomes reachable as those clear.

## Verdict

**PASS.** Zero defects. Nothing to bounce and nothing to record in the bounce log. This
is careful work: the fail-open trap the ticket was written around is closed and proven
closed, the invariants are encoded with asserted reachability, the acceptance handler
drives the real CLI rather than a stand-in, and the ordering decision is pinned in both
directions. Forwarding to the hardener under the same task name; S1 goes to the
specifier and coordinator as a note.
