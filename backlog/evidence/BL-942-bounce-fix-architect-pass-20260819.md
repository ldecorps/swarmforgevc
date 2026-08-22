# BL-942 architect pass (bounce fix) — 2026-08-19

## Scope

Received directly from coder as `merge_and_process coder bfa5fa351c`
(priority 50, same direct-reply-to-bouncer pattern as BL-945's fix
earlier today). Ancestry confirmed: `git merge-base --is-ancestor
8911d8ce3 bfa5fa351c` — my own BL-942 bounce commit is an ancestor, and
the fix commit's own message names "D1" by the same label used in
`backlog/evidence/BL-942-architect-bounce-20260819.md`.

Files touched (`git show --stat bfa5fa351c`): `swarmforge/scripts/hardening_debt_ledger_lib.bb`
(the escaping fix) and `swarmforge/scripts/test/hardening_debt_ledger_lib_test_runner.bb`
(new regression coverage).

## Checks run (complete inventory, not first-failure-stop)

1. **Fix mechanism read and traced by hand**: `escape-quoted`/
   `unescape-quoted` are single-pass character walks (`mapcat`/`loop`
   over individual chars), not two sequential `str/replace` calls — this
   matters because a naive two-pass escaper mis-round-trips once an
   escaped `\` and an escaped `"` sit adjacent (double-escaping or
   under-escaping depending on pass order). `find-closing-quote` skips a
   whole `\X` pair on any backslash rather than stopping at the first
   raw `"`, so it can never mistake an escaped quote for the real closing
   delimiter.
2. **My exact original bounce reproduction re-run, not assumed fixed**:
   `(hdl/render-ledger [{... :reason "blocked by the \"quiet host\"
   promise" ...}])` round-tripped through `parse-ledger` — now returns the
   reason UNCHANGED (previously truncated to `"blocked by the "`).
3. **The trickier adjacent-escape edge case independently constructed and
   tested** (not just the coder's own claim): a reason ending in a literal
   backslash immediately followed by a quote character, and a reason
   ending in a bare trailing backslash — both round-trip exactly. This is
   the specific case a two-pass replace-based escaper gets wrong; verified
   this implementation does NOT use that shape and handles it correctly.
4. **Re-reproduced through the real CLI end-to-end**, matching my original
   bounce's own methodology: `hardening_debt_ledger_update.bb --defer`
   with a reason containing `"quiet host"`, followed by
   `hardening_debt_ledger_read.bb` — the ledger file now shows the reason
   correctly escaped on disk (`\"quiet host\"`) and the JSON reader
   returns it correctly unescaped. No corruption, full round trip through
   the actual tools a hardening pass would call.
5. **Non-vacuity independently re-verified by hand, not just trusted from
   the commit message**: reverted `escape-quoted` to a no-op (`(defn-
   escape-quoted [s] (or s ""))`), ran the unit test runner — exactly the
   3 new regression checks failed (the quote-escaping check, the
   quote-round-trip check, the backslash-adjacent-to-quote check), nothing
   else. Restored from an untouched backup, confirmed `git diff` empty,
   reconfirmed the full suite green again.
6. **New regression coverage matches my bounce's own remediation ask**:
   the unit test runner now asserts exact round-trip equality for both
   the embedded-double-quote case and the backslash-adjacent-to-quote
   case — closing the coverage gap my bounce identified (no prior test
   exercised either).
7. **Full existing suite re-run**: unit test runner pass; property runner
   (`bl942_hardening_debt_ledger_property_runner.bb`, 600 trials across
   P1+P2, file itself untouched by this fix) pass; CLI shell test 15/15
   pass; acceptance feature 5/5 pass.
8. **Dependency-rule gate**: N/A — no JS/TS file in this fix's diff (both
   changed files are `.bb`).
9. **Co-change report**: all co-changes at frequency ≤2, nothing above
   the suspected-coupling threshold (3) — the ticket's own natural
   cluster, nothing new.

## Verdict

D1 from my own prior bounce is fixed and independently re-verified,
including the trickier adjacent-escape edge case I did not originally
name but which the coder correctly anticipated and covered, and including
a hand-driven non-vacuity check on the new regression tests. No new
defect found. Forwarding to hardener.

By architect.
