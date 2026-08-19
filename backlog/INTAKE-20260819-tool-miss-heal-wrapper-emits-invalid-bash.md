# INTAKE 2026-08-19 — tool_miss_heal PreToolUse wrapper emits invalid bash, stalling roles

**Raised by:** human (operator), 2026-08-19 ~19:55 local, via screenshot of the
QA session showing 11+ consecutive `Background shell failed __sfh_root=…` errors.
**Observed by:** coordinator, which independently hit the same failure twice in
its own session in the preceding minutes.

## Symptom

Roles' Bash tool calls fail wholesale with `Background shell failed
__sfh_root=…`. Live impact at filing time: QA sat **50 minutes "Ruminating"
with no commit for ~48 minutes** while its shell calls failed, with an
unactioned handoff queue behind it (BL-954 claimed, BL-955/BL-827 waiting).

## Mechanism (confirmed by reading the source, not inferred)

`swarmforge/scripts/swarmforge.sh:1278` registers
`tool_miss_heal_hook.bb` as a **PreToolUse:Bash** hook, so it rewrites
*every* Bash command every role issues. The rewrite is
`build-healing-wrapper-command` in `swarmforge/scripts/tool_miss_heal_lib.bb`
(~line 112), which splices the original command as **raw text** into a command
substitution:

    __sfh_out=$(<ORIGINAL COMMAND> 2>&1); __sfh_ec=$?

…and repeats that splice once per miss-class clause (4 copies total today).
The original command is never escaped, and the composed result is never
validated as parseable bash.

### Defect 1 — raw splice into `$( … )` breaks whole classes of valid commands

Any command that is valid on its own but cannot survive being textually
embedded in `$( … )` becomes a syntax error:

- **Heredocs** (`cat <<'EOF' … EOF`) — body is swallowed/mangled. Observed:
  a heredoc-written file landed **truncated at 776 bytes**, cut off at the
  first line the wrapper broke on.
- **Unbalanced/《literal》parens** — e.g. a `sed` replacement containing `)`
  closes the substitution early. Observed verbatim:
  ``syntax error near unexpected token `)` `` and, downstream,
  ``syntax error near unexpected token `elif` `` as the wrapper's own
  scaffolding was left dangling.

Failure is **silent-partial**, which is the dangerous part: the shell may
still execute some of the mangled command before dying, so state changes
land while an error is reported. A retry is therefore NOT safe by default —
callers must verify state first.

### Defect 2 — `:missing-root-argv` appends the root to the wrong command

`healed-command`'s `:missing-root-argv` branch is
`(str original-command " \"$__sfh_root\"")` — it appends `"$__sfh_root"` to
the end of the **entire command string**, not to the program that actually
wanted the argument. For any pipeline or `;`-sequence the argument lands on
the final segment. Captured live from the hardener's session:

    echo "---done---" "$__sfh_root"

The root was appended to a trailing `echo`, which is meaningless.

## Why this matters beyond the immediate stall

The hook is on the **PreToolUse** path for every Bash call from every role, so
its blast radius is the whole swarm, and a role cannot route around it. This
is machinery, not domain behavior — per BL-567 the fix likely cannot ride the
pipeline it is repairing; consider the expeditor.

## Scope note for the specifier

`backlog/paused/BL-912-epic-tool-miss-auto-heal.yaml` is the existing epic and
BL-913 shipped this hook (`docs/how-to/BL-913-pinned-shell-and-tool-miss-auto-heal.md`).
Please check whether this belongs as a defect **under** BL-912 or as its own
ticket, rather than assuming a new id. Suggested `type: defect`; severity is
the specifier's call, but note the live QA stall as evidence.

## Operator decision requested (not taken here)

Whether to **temporarily disable the hook** (`swarmforge.sh:1268-1278`) until
this is fixed. That is a config/capacity change and therefore the operator's
call, not the coordinator's — flagging it rather than acting.

## Suggested acceptance direction (specifier's to refine)

- The composed wrapper is **parse-checked** (`bash -n`) before being returned;
  if it does not parse, the hook returns the original command untouched
  (fail-open, which is already the hook's stated posture for its own errors).
- Round-trip property: for a corpus of commands including heredocs, nested
  quotes, parens, pipelines and `;`-sequences, the wrapper's no-failure path
  produces output byte-identical to running the command unwrapped.
- `:missing-root-argv` appends the root to the intended command, not to the
  tail of a pipeline.
