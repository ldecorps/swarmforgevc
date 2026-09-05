# BL-1411 — architect pass, 2026-09-05

Ticket: BL-1411-a-forward-built-on-an-amended-contract-is-refused
Role: architect
Commit reviewed: a25efb737b (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1411ContractFreshnessGateSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is a new Babashka send-path gate library
  (`contract_freshness_gate_lib.bb`) wired into `swarm_handoff.bb`'s
  existing validation `cond->` chain, plus a Node step handler shelling
  out to a real fixture CLI — no webview, no VS Code API, no secrets, no
  browser storage.
- **Co-change report**: `swarm_handoff.bb` shows the wide standing
  coupling any change to the send-path validation chain always shows (its
  sibling gates — task-scope, pre-QA, duplicate-chain, required-stages —
  and their own tests) — pre-existing structure, nothing new or suspicious.

## Invariants Review (BL-633/654)

Ticket declares three invariants, each with independent verification:

1. **Range is main-vs-sender's-base, never the parcel tip.** Read
   `contract_freshness_gate_lib.bb` by hand: `merge-base` is computed
   between the sender's `commit` and the ref (`main`/`origin/main`), and
   `path-differs?`/`amending-commits` both diff `base..ref`, never
   touching the parcel's own tip content. Confirmed by driving the real
   fixture CLI myself (below) with `own-header-rewrite` (the sender's own
   edit to its own copy) — queued, no refusal, exactly as invariant 1
   requires.
2. **One reader of `acceptance:`.** `grep -c "read-yaml-field\|acceptance:"`
   returns 0 in `contract_freshness_gate_lib.bb`; the path comes from
   `task-scope-gate-lib/declared-acceptance-path` (`grep -c
   declared-acceptance-path` ≥ 1) — confirmed by reading the file, no
   second parser of the ticket YAML.
3. **Fail-open, one-line statement, never a refusal, on an unreadable
   contract.** `decide-for-ref`'s pure branching returns `:not-evaluated`
   for every unreadable case (ref absent, no merge-base, path absent,
   diff unreadable) and only `:refuse` when the diff positively differs —
   confirmed both by reading the pure decision function and by
   independently running the `path-absent` fixture mode myself: queued,
   with `CONTRACT_FRESHNESS_NOT_EVALUATED: ... the acceptance path is
   absent on main` on stderr, never a refusal.

Independently re-ran the coder's unit runner and property test:

```
bb contract_freshness_gate_lib_test_runner.bb → ALL PASS
bb bl1411_..._property_runner.bb → 300 runs each, ALL PROPERTIES HOLD,
  wide coverage across every decide-for-ref branch (:refuse, :clean,
  :not-evaluated × 4 reasons) and both parcel-edit vs main-amend cases
```

## Acceptance wiring — driven end-to-end myself

This ticket's acceptance handler shells out to the REAL
`swarm_handoff.sh` over a real two-checkout git fixture
(`bl1411ContractFreshnessGateCli.sh`), not the gate lib in isolation —
the strongest form of verification available. I ran all 5 fixture modes
myself directly against the CLI (not just via the JS step layer):

- `unchanged` → exit 0, delivered, no `CONTRACT_AMENDED_SINCE_BASE`
- `amended` → exit 2, not delivered, refusal names
  `CONTRACT_AMENDED_SINCE_BASE`, `HANDOFF_NOT_QUEUED`, the amending commit,
  `specs/features/BL-9001-fixture.feature`, and the merge-and-resend remedy
- `own-header-rewrite` → exit 0, delivered, no refusal (invariant 1)
- `merged-first` → exit 0, delivered, no refusal (sender already caught up)
- `path-absent` → exit 0, delivered, `CONTRACT_FRESHNESS_NOT_EVALUATED`
  naming the reason, never a refusal (invariant 3)

All 5 match the feature's 5 scenario runs exactly. `registerSteps` export
present per the ticket's `required_wiring` anchor (BL-1371);
`grep -n contract-freshness-gate-lib/refusal-message swarm_handoff.bb`
matches inside the live validation chain (the other `required_wiring`
anchor) — confirmed by reading the surrounding `cond->` clause, not grep
alone: `contract-freshness-block` is threaded into the same refusal-message
accumulation the task-scope gate already uses.

No leftover fixture temp dirs after my 5 manual runs (checked
`/tmp/tmp.*` modified in the last 5 minutes: none) — the CLI's own
`finally`-style cleanup holds.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
