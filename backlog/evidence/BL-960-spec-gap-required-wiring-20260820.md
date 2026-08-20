# BL-960 — spec gap: `required_wiring` pattern is unsatisfiable as authored

**Raised by:** documenter, 2026-08-20. **Not a bounce** (Article 4.4: a
spec-gap item leaves as a `note` to specifier + coordinator, never as a
parcel). The parcel is held at documenter, not sent back.

## Finding

The documenter→QA forward for BL-960 is refused by `swarm_handoff.sh`'s
pre-QA wiring gate, and no commit can ever satisfy it.

    PRE_QA_GATE_FAIL wiring BL-960 swarmforge/scripts/swarmforge.sh
    does not contain "\"PreToolUse\": ["

The ticket declares (block-style list, double-quoted YAML scalar):

    required_wiring:
      - "swarmforge/scripts/swarmforge.sh::\"PreToolUse\": [::..."

`pre_qa_gate_lib.bb`'s reader is **not a YAML parser**. `read-list-field`
takes the raw line and calls `strip-quotes`, which is only:

    (str/replace s #"^[\"']|[\"']$" "")

That removes the *outer* quote characters. It does **not** process `\"`
escape sequences, so the inner backslashes survive into the pattern.

## Measured, not inferred

Parsed through the gate's own reader:

    PATTERN AS PARSED: "\\\"PreToolUse\\\": ["
    PATH: swarmforge/scripts/swarmforge.sh

Counted at the cited commit `6ccd41b778`:

| form | occurrences |
|---|---|
| `\"PreToolUse\": [` (what the gate searches for) | **0** |
| `"PreToolUse": [` (what the file contains) | **1** |

## The wiring itself is delivered

This is a gate-expressibility defect, not missing work. `swarmforge.sh`
carries the restored registration block, and its comment names BL-960 and
the operator's disable commit `3bac496ec`. Verified present at the received
commit `c8faaa6ad1`, at the cited commit `6ccd41b778`, and in the working
tree — one occurrence each.

## Why the documenter did not fix it

`required_wiring` is the ticket's contract and the specifier's field
(documenter role: "Do not define requirements — that is the specifier's
job"). Editing it to make my own forward pass would be marking my own
homework: the gate exists precisely so a wiring claim is checked against
something the author committed to in advance.

## Suggested remediation (specifier's call)

Restate the pattern as a literal that occurs in the file — e.g. use single
quotes for the YAML scalar so no `\"` escaping is needed, or choose a
pattern with no quote characters at all (`PreToolUse` alone would match the
unquoted mentions in comments too, so it needs care — the ticket's own
rationale notes it must not pass vacuously).

Note this is a *general* hazard for any `required_wiring` pattern containing
a double quote, not specific to BL-960. See also the pre-existing lesson that
a `required_wiring` pattern must be a literal substring of the target file.
