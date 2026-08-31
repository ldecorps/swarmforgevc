# BL-1305 — coder spec-gap report, 2026-08-31

## Summary

The defect in the ticket is real and reproduces exactly as described. The
REMEDY the ticket names, however, cannot be built inside the ticket's stated
scope: the config's agent column is validated against a closed allowlist, so
an absolute path in that column is refused before anything launches.

Scenarios 02 and 03 are buildable handler-side. Scenario 01 and invariant 2
are not. Sending this as a `note` (Article 4.4: a spec gap leaves by note,
never a parcel) rather than bouncing or silently redefining the scenario.

## The defect reproduces (confirms the ticket)

`~/.zshenv:7` is `export PATH="$HOME/.local/bin:$PATH"`, and the real binary
is `/home/carillon/.local/bin/claude`. zsh sources `$ZDOTDIR/.zshenv` on
EVERY invocation, including the non-interactive `zsh -c` inside
`role_lifecycle.sh` and the generated `#!/usr/bin/env zsh` launch script. So
the fixture's PATH prepend is re-ordered after the fixture sets it:

    $ PATH="$FAKEBIN:$PATH" zsh -c 'command -v claude'
    /home/carillon/.local/bin/claude          # <- real binary, stub defeated

## Why the named remedy cannot be built (measured, not read)

The ticket's direction is "writing the stub's absolute path into the fixture
config's command column". Run directly against `parse_config`:

    window coder /tmp/.../fakebin/claude coder --model x
    -> Error: Unsupported agent '/tmp/.../fakebin/claude' for role 'coder'

    window coder claude coder --model x
    -> OK AGENTS[1]=claude

`validate_agent` (swarmforge/scripts/swarmforge.sh:522) is a closed
allowlist: `claude|codex|copilot|grok|aider|vibe|gemini|cursor|local-model`.
A path is refused with `exit 1`.

Two further blocks behind it, so relaxing the allowlist alone is not enough:

1. `write_role_launch_script` (swarmforge.sh:1683) dispatches on
   `case "$agent" in claude)` and the branch HARDCODES the literal command
   `claude ...` into the launch body. A path would fall to `*)` ->
   `error_msg "Unsupported agent" ; exit 1`.
2. `agent` is compared for exact equality at 14 further sites in
   swarmforge.sh (1344, 1469, 1846, 1853, 1870, 1940, 1999, 2018, 2055,
   2092, 2117, plus the case statements at 524, 1223, 1683). Each drives
   real launch behaviour - model resolution, the billing guard, and the
   provider-API-key forwarding branch.

Making the config accept a path therefore means a basename-dispatch change
across the swarm's own launch machinery. That is a genuine capability and
arguably good design, but it is not `slice_size_envelope: low`, and it
changes how EVERY seat launches - including the live swarm's own.

Note this also means the scenario cannot "just fail closed": with a path in
the column, `parse_config` exits 1, nothing launches at all, and scenarios
02/03 would pass VACUOUSLY - which the ticket's own `qa_e2e` explicitly
forbids ("Confirm the fixture stub did run, so the scenarios are not passing
merely because nothing launched").

## What IS buildable handler-side, and verified

zsh reads `$ZDOTDIR/.zshenv`, not `~/.zshenv`, when ZDOTDIR is set. Pointing
ZDOTDIR at a fixture-owned directory removes the re-orderer entirely:

    $ PATH="$FAKEBIN:$PATH" ZDOTDIR="$FIXTURE_ZDOT" zsh -c 'command -v claude'
    /tmp/.../fakebin/claude                   # <- the stub
    $ PATH="$FAKEBIN:$PATH" ZDOTDIR="$FIXTURE_ZDOT" zsh -c 'claude --whatever'
    STUB

Verified ZDOTDIR propagates into a tmux pane (probed the pane's own env).
This satisfies invariant 1 in full - no step handler executes a real agent
binary - and scenarios 02 and 03. It does NOT satisfy invariant 2 as worded
("reaches its stub by a path the shell cannot re-order, never by PATH-prefix
precedence alone"), because it is still PATH precedence, inside a shell whose
startup file can no longer re-order it.

## What the specifier needs to rule

One of:

(a) Amend scenario 01 and invariant 2 to the achievable mechanism (fixture-
    owned ZDOTDIR isolation). Keeps the slice low-cost and stops the harm.
    Invariant 2 would become something like "the fixture's stub resolves in a
    shell whose startup files cannot re-order PATH".

(b) Keep scenario 01 as written and widen scope (or split a second ticket)
    for "the agent column may name a binary by path", basename-dispatched
    across the 14 sites above. Then this ticket waits on it.

Recommendation: (a). The harm this ticket exists to stop is real agents
booting; (a) stops it completely and at low risk. (b) is a legitimate
capability but it is a separate, mutation-heavy change to the launch path
every live seat uses, and it should not ride a fixture-hygiene ticket.

## Live-orphan question in approval_context is now moot

`approval_context` asked the human whether to kill the 21 orphaned agent
processes or leave them. Measured on this host now: real agent processes
launched from an `aps-role-lifecycle` fixture root = 0, and
`/tmp/aps-role-lifecycle-*` and `-fakebin-*` dirs = 0. The 8 remaining
claude processes are the live swarm's own, matching the ticket's own note.
Nothing was hand-killed by the coder; they are simply gone. No decision is
owed here any more.

By coder.
