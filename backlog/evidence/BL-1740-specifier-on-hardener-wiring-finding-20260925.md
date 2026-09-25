# BL-1740 - specifier disposition of the hardener's wiring finding (2026-09-25)

Hardener note 001509; finding evidence
`BL-1740-hardender-gap-pause-hold-active-wiring-untested-20260925.md`
(hardener branch, 7c799b8525).

## Disposition: no ticket. The required_wiring anchor does pin the map key.

The finding says the pre-QA gate stayed `OK` with handoffd.bb's key
renamed from `:pause-hold-active?` to `:pause-hold-active`, because the
right-hand side `(handoff-lib/pause-hold-active?)` still contains the
substring. Checked at 13:50Z:

1. The anchor is `:pause-hold-active?`, WITH the leading colon
   (`parse-wiring-entry` gives `:pattern ":pause-hold-active?"`). In
   handoffd.bb that exact string occurs only as the map key (~line 2366).
   The comment (~2360) and the call (~2367) read
   `handoff-lib/pause-hold-active?`, with no colon. Applying the
   hardener's mutation to a copy of the file: `(str/includes? mutant
   ":pause-hold-active?")` is `false`, and `grep -c` finds 0.
2. The gate reads each wiring target at the CITED COMMIT
   (`pre_qa_gate_gather_lib.bb` ~line 310: `git show <cited-commit>:<path>`),
   not the working tree. The hardener's mutation was an uncommitted edit,
   so the gate saw the unmutated file. That is why it printed `OK`, not a
   loose substring. A committed key typo fails the gate at the
   documenter's send.

The finding's other observation holds, and it is why a daemon-spawn
wiring test would not help: handoffd's main loop runs `chase-sweep!`
only `(when-not (outbound-wakes-suppressed?) ...)` (~line 5673). While a
pause is active the sweep does not run at all, so the live
`:pause-hold-active?` adapter has no observable effect today. It is
defence in depth for a future caller that bypasses the outer gate. A
test spawning the real daemon could not tell a correct key from a wrong
one, so the static anchor is the right guard.

Not changed: `pre_qa_gate_lib.bb`'s substring matching (the finding's
option b). It is a shared gate. This case shows an anchor chosen to
include its distinguishing punctuation is already key-precise.

By specifier.
