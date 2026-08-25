# BL-942 architect bounce — 2026-08-19

## Reviewed commit

`bfeeef67e` ("BL-942: durable ledger for deferred hardening gates
(mutation/CRAP)", By coder), forwarded unchanged by cleaner (`a81f403dfd`
is a pure merge commit).

## Checks run (complete inventory, not first-failure-stop)

1. **Unit test runner** (`hardening_debt_ledger_lib_test_runner.bb`): pass.
2. **Property test runner**
   (`bl942_hardening_debt_ledger_property_runner.bb`, coder-authored per
   coder.prompt's Invariants section, 2 properties × 300 seeded trials
   each): pass. Read directly to confirm scope: P1/P2 exercise
   `record-deferral`/`outstanding-debt` — the in-memory pure decision core
   only. Neither generates a `reason`/`load` value beyond a fixed constant
   string or a numeric-slash triple, and neither round-trips through
   `render-ledger`/`parse-ledger` (the on-disk text serialization). See D1.
3. **CLI shell test** (`test_hardening_debt_ledger_cli.sh`): 15/15 pass.
4. **Acceptance feature**: 5/5 pass.
5. **Dependency-rule gate (BL-259 hard gate)**: PASSED, no forbidden edges
   (per-parcel against the one JS file in the diff).
6. **Co-change report (BL-255)**: no co-changers found for any of the 8
   changed files — all new, no history yet, nothing flagged.
7. **Fixture discipline**: the acceptance step handler tracks every
   `mkTmp()` root in `afterEach`, same established shape as this session's
   other fixture-heavy files. Independently confirmed 0 leaked `bl942`-
   named dirs before and after a real acceptance run.
8. **Seed ledger** (`backlog/hardening-debt-ledger.yaml`): header-only,
   confirmed empty — correctly does not backfill the 35 August deferrals
   (explicitly out of scope).
9. **Module boundaries**: not implicated — no `extension/src/` file
   touched, no secrets, no webview storage, no process spawned bypassing
   tmux.
10. **No `required_wiring` declared** on this ticket — confirmed, nothing
    to check.
11. **Storage-shape precedent fidelity**: confirmed
    `hotfix_certification_lib.bb`'s own fields (`commit`, `state`,
    `stamp_ticket`, `human_decision`, `decided_at`) are all narrow,
    bounded tokens — never free-form prose. BL-942 is the FIRST ledger of
    this shape asked to store genuinely free-text fields (`reason`,
    `load`). This is directly relevant to D1 below: the defect is not an
    inherited limitation of the precedent, it is new exposure created by
    this ticket's own choice of what to store in that shape.

Items 1-11 above are clean. One defect found, in the surface item 2's own
scope did not reach.

## D1 — `reason`/`load` silently corrupt on round-trip when they contain a
literal double-quote character, losing data with no error

**Class**: `behavior` (correctness defect I can see) — bounced per the
architect prompt's own standing rule that a concrete defect spotted during
review is a send-back even when the parcel is otherwise clean (BL-333
precedent).

**Where**: `swarmforge/scripts/hardening_debt_ledger_lib.bb` —
`render-row` (lines 91-97) wraps `reason`/`load` in literal `"..."` with
no escaping of an embedded `"`; `strip-inline-comment`/`unquote-str`
(lines 42-53) do a naive first-matching-quote strip on the way back in,
with no unescaping counterpart.

**Reproduced twice, not assumed** — first at the pure-lib level:
```
(hdl/render-ledger [{:parcel "BL-999" ... :reason "blocked by the \"quiet host\" promise" ...}])
```
renders `reason: "blocked by the "quiet host" promise"` (invalid — two
unescaped inner quotes), and re-parsing it back through `parse-ledger`
returns `:reason "blocked by the "` — `quiet host" promise` is silently
gone, no exception, no warning.

Second, through the REAL CLI a hardening pass would actually invoke:
```
bb swarmforge/scripts/hardening_debt_ledger_update.bb <root> --defer BL-999 mutation "a.ts,b.ts" \
  'blocked by the "quiet host" promise' "44/27/22" 2026-08-19
bb swarmforge/scripts/hardening_debt_ledger_read.bb <root>
```
writes the same corrupted line to disk and the reader confirms it back:
`"reason":"blocked by the "` — the same silent truncation, end to end,
through the tools a hardener would genuinely call, not a contrived
internal-API-only case.

**Why this is a real defect, not a contrived edge case**: `reason` is
free-form text a hardening pass writes to explain WHY it deferred — this
is exactly the kind of prose an LLM-authored reason naturally produces,
and the ticket's own source material makes the risk concrete: the
office-hours bypass rule this ticket exists to hold accountable is quoted,
in the ticket's own `description`, as promising the pass "still runs —
just against a quiet host" (with an em-dash and inline emphasis a
hardener reason might reasonably echo or quote back). Any reason text
that quotes a phrase, a file path in quotes, or a piece of prose
containing an apostrophe-adjacent quote character loses everything after
the first `"` — silently. Given invariant 2's own text — "names the exact
file set that was skipped **and why**" — a corrupted `reason` field is a
direct violation of the declared invariant, not a tangential quality nit:
the record LOOKS present and machine-readable (no crash, no error) but is
factually wrong, which is arguably a worse trap than the missing-record
problem this ticket exists to fix, because it manufactures false
confidence that the "why" was captured when it was not.

**No existing test catches this**: grepped every one of the four test
files (unit runner, property runner, CLI shell test, acceptance feature)
for a `reason`/`load` value containing a `"` character — zero hits. The
property runner (item 2 above) is architecturally incapable of catching
it regardless of trial count, because it never calls
`render-ledger`/`parse-ledger` at all — it only exercises the in-memory
decision core, which is a real and correct scope for invariants 1/2's own
claims (they are stated over the pure decision core's inputs/outputs,
not the serialization format), but leaves the text round-trip
completely unverified against adversarial input.

**Remediation** (direction, not mandate): escape embedded `"` (e.g. to
`\"`) in `render-row` for the `reason`/`load` fields, and unescape the
matching sequence in `unquote-str` on the way back in — the minimal fix
that keeps the chosen line-based storage shape (per the ticket's own
"follow the hotfix-ledger precedent, don't invent a new idiom" direction)
rather than replacing it. Add at least one round-trip test (unit or
property) that specifically exercises a `reason`/`load` value containing
an embedded double-quote and confirms it survives `render-ledger` +
`parse-ledger` unchanged — the gap item 2 above identifies. Worth noting
while fixing, though not separately reproduced here: the same line-based
format has no escaping for an embedded newline either, which would
corrupt row boundaries rather than just one field; whether that is worth
guarding is the coder's call, but the `"` case above is the one this
bounce requires fixing, since it is the one confirmed to reproduce through
realistic input.

## Everything else in this parcel is clean

Items 1-11 above. D1 is the only item in this inventory.

By architect.
