# BL-1404 — architect pass, 2026-09-05

Ticket: BL-1404-recorded-waive-silences-escalation
Role: architect
Commit reviewed: 16df51de21 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1404WaiveSilencesEscalationSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is a single one-line fix in a Babashka daemon script
  (`babysitter_check.bb`: `decide-escalations` now reads `nudgeable`
  instead of raw `findings`) plus a Node step handler using standard
  library modules only — no webview import, no VS Code API, no secrets, no
  browser storage.
- **Co-change report**: `babysitter_check.bb` shows the wide standing
  coupling any change to that central sweep-orchestration file always
  shows (its own sweep-lib/operator/ACP family) — pre-existing structure,
  nothing new introduced by this one-line diff.

## Invariants Review (BL-633/654)

Ticket declares two invariants. The fix itself is minimal and traceable by
hand: `partition-findings` (`babysitter_waive_lib.bb`) already computes
`nudgeable` = `:to-nudge`, which on a readable store excludes waived keys
and on an unusable store equals the full findings list (`:to-nudge (vec
findings)`) — so passing `nudgeable` into `decide-escalations` instead of
raw `findings` automatically preserves the unusable-store-escalates-
everything symmetry (invariant 2) for free, exactly as the coder's own
comment claims. The WAIVED log line (`"WAIVED [<key>] nudge suppressed by
a recorded waive"`) is unchanged and still fires per waived finding
(invariant 1's "visible overlay, never erasure") — checked this is
unaffected by the diff since the log site is separate from the decision
call the fix touches.

Independently re-ran the coder's property test:

```
generator coverage: {:has-waived-crit 206, :has-unwaived-crit 409, :no-waives-at-all 263}
bl1404 waive-silences-escalation properties: 500 runs each
ALL PROPERTIES HOLD
```

and the full shell test suite (regression + new scenarios):

```
bash test_babysitter_check.sh → 21/21 PASS, including all four new BL-1404
  scenarios (N: unwaived still escalates; O: waive silences both channels;
  P: two findings, one waived, only the other escalates; Q: corrupt store
  escalates everything + WAIVE-STORE-UNUSABLE)
```

## Acceptance wiring

Feature declares 4 scenarios / 4 scenario runs. Independently drove
`bl1404WaiveSilencesEscalationSteps.js::registerSteps` against all 4 with
my own harness — all passed. `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371). No consumer `required_wiring`
anchor is declared for the call-site fix itself, per the ticket's own
note (BL-1235 fail-open: the parcel's own diff at the one call site is
what proves the wiring, and the extended property/shell tests are what
prove it functions) — confirmed by reading the diff: it is exactly the one
line the ticket names.

## Minor wording note (not a defect)

The WAIVED log line's text ("nudge suppressed by a recorded waive") does
not literally mention the escalation channel now also suppressed by the
same waive. This is not inaccurate — the nudge IS suppressed, and the
ticket's invariant 1 requires only that the key "still reports it as
WAIVED on the record," which it does — so not a send-back; flagging only
in case the documenter wants a clearer phrase.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
