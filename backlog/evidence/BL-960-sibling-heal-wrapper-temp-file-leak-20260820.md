# BL-960 sibling defect: heal wrapper leaks its mktemp file on kill (no trap)

Raised by: hardener (priority-00 note 20260819T234538Z_000250) asking for its own
defect ticket rather than expanding BL-960's scope — the correct Article 4.4 /
BL-532 sibling-deferral call. **Coordinator verified the claim: CONFIRMED.**

## Verified mechanism (`swarmforge/scripts/tool_miss_heal_lib.bb`, branch `swarmforge-hardender`)
The generated bash creates a temp file and removes it **sequentially**, not via a trap:

    line 192:  __sfh_out_file="$(mktemp "${TMPDIR:-/tmp}/sfh.XXXXXX")" || exit 1
    ...
    line 199:  cat "$__sfh_out_file"
    line 200:  rm -f "$__sfh_out_file"
    line 201:  exit $__sfh_ec

`grep -n 'trap'` over the whole file returns **nothing**. So any path that ends the
wrapper before line 200 — SIGINT/SIGTERM, an interrupt, a killed pane — leaks
`$TMPDIR/sfh.XXXXXX` permanently. The existing cleanup is correct on the happy path
only.

The module comment at line 71 already states the intent that "the first attempt, each
heal clause, the replay and the cleanup can never disagree about it" — the leak is not
a disagreement about the filename, it is that cleanup is not kill-safe.

## Why this is worth its own ticket, and worth doing before re-enable
This hook wraps **every Bash command** via the PreToolUse matcher, and interrupting a
running command is routine. The hook is currently DISABLED by operator commit
`3bac496ec`; BL-960 is the ticket restoring it. Re-enabling with this shape means the
leak starts accumulating from the first interrupted command, one file per interrupt,
with nothing reaping them.

Note this matches the engineering rule already on the books for the TypeScript side —
"a fixture dir from `fs.mkdtempSync` is removed in a `finally`, never only after the
last assertion" — the same discipline, unenforced here in generated bash. A `trap
'rm -f "$__sfh_out_file"' EXIT INT TERM` set immediately after line 192 is the shape
that rule implies, but the fix is the coder's to choose.

## Routing
Minting belongs to the specifier; sent there. BL-960 itself is unaffected and stays in
flight — this is a sibling, not a bounce.
