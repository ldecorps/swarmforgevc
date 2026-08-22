# BL-960 required_wiring pattern is UNMATCHABLE — gate blocks an in-flight ticket

Raised by: documenter (priority-00 note 20260820T002420Z_000219).
**Coordinator verified by running the real gate parser. CONFIRMED — and it is blocking.**

## The mismatch
BL-960's `required_wiring` is a YAML double-quoted scalar containing escaped quotes:

    - "swarmforge/scripts/swarmforge.sh::\"PreToolUse\": [::<rationale>"

A real YAML parser unescapes that to the intended literal:

    python3 yaml.safe_load  ->  '"PreToolUse": ['        (correct)

The gate does NOT use a YAML parser. `pre_qa_gate_lib.bb` reads the field with a
hand-rolled `read-list-field` -> `parse-block-list` -> `block-item` -> `strip-quotes`,
which strips only the SURROUNDING quotes and never unescapes inner `\"`. Verified by
loading the actual lib and calling it on the actual ticket file:

    (pre-qa-gate-lib/read-required-wiring content)
    PATTERN: "\\\"PreToolUse\\\": ["            <- backslashes retained

So the gate searches `swarmforge.sh` for the literal `\"PreToolUse\": [`.

## Consequence: fails CLOSED, and the work is already correct
Occurrences of each form in `swarmforge/scripts/swarmforge.sh`:

    branch                 escaped(what gate seeks)   unescaped(what exists)
    main                   0                          0
    swarm/coder            0                          1
    swarmforge-hardender   0                          1

The escaped form exists nowhere and cannot — nothing would ever write it. The coder
DID restore the hook correctly (the unescaped literal is present on both in-flight
branches). The wiring check therefore can never be satisfied, and per
`pre_qa_gate_gather_lib.bb` lines 12-15 an unsatisfiable/unparseable `required_wiring`
is **the one fail-CLOSED case** — it blocks the send rather than warning.

Net: BL-960 cannot be forwarded to QA, not because the fix is missing but because the
ticket's own spec text makes its gate unsatisfiable. Contrast BL-968 (gate blind, fails
OPEN): this one fails closed. Same gate family, opposite failure directions, both live.

## Two fixes, both wanted (specifier's call on sequencing)
1. **Immediate unblock** — restate BL-960's `required_wiring` without escaped quotes
   (a single-quoted YAML scalar, or a pattern that does not need inner quotes at all).
   Amending an in-flight ticket goes by note to whoever HOLDS the parcel, per the
   amend-in-flight rule, not by editing under it.
2. **Durable** — make the gate unescape properly (parse YAML rather than hand-roll
   `strip-quotes`). Otherwise every future ticket whose pattern needs a quote hits this.
   Note the existing rule "required_wiring pattern must be a literal, never a
   placeholder" already assumes the parsed literal is what gets searched; it is not.
