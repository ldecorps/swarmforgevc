# `seat` — a local aider seat's whole command vocabulary (BL-1696)

**Last Updated:** 2026-09-25

## What it is

A headless aider seat has no shell channel: aider never runs a `!` line
from a model reply, and it auto-declines fenced shell blocks under
`--yes-always`. `swarmforge/scripts/seat <verb> [args]` is the entire set
of pipeline actions such a seat can perform. Each verb runs **at most** the
one script or git subcommand it names; every caller-supplied argument
reaches that script as its own argv element and is never evaluated by a
shell. A malformed argument, or a verb outside the running role's set,
refuses (exit 2) before anything runs — the working tree is left
unchanged.

The consumer is the local parcel driver (BL-1697), which types
`/run seat <verb> ...` into a seat's pane — the one path aider executes
headless. `seat` itself has no live caller yet.

Runnable from any role's checkout on stock macOS `/bin/bash` 3.2 (no
`mapfile`/`readarray`/`declare -A`).

## Roots

- **Checkout root**: `git rev-parse --show-toplevel`.
- **Project root** (for `role_ask.bb` and `.swarmforge/roles.tsv`): the
  parent of `git rev-parse --path-format=absolute --git-common-dir`.

## Role

Read from `SWARMFORGE_ROLE`. Unset means every verb is refused — there is
no default role.

## Verbs

| verb | runs | exit codes |
|---|---|---|
| `next` | `ready_for_next.sh` | passthrough |
| `done` | `done_with_current.sh` | passthrough |
| `ask "<text>"` | `role_ask.bb <project-root> --role <role> --question <text>` | passthrough |
| `note <role> <NN> "<text>"` | writes a `note` draft (`to`, `priority`, `message`, message ≤80 chars) and runs `swarm_handoff.sh` on it | passthrough |
| `handoff <role> BL-<n>` | writes a `git_handoff` draft (task `BL-<n>`, commit = the checkout's 10-hex HEAD, priority `50`) and queues it through the two-call self-audit protocol (Article 2.3, BL-1529) | passthrough, or 2 if the audit challenge repeats on an identical draft |
| `merge <from-role> <sha>` | `git merge --no-ff --no-edit <sha>`; on conflict, prints the conflicted paths and runs `git merge --abort` | 0, or 3 on conflict (aborted) |
| `test` | the live pack's declared `seat_test_command` (from the effective pack conf, resolved the way `active_backlog_max_depth` is); refuses if none is configured. When `SEAT_TICKET`/`SEAT_ACCEPTANCE` are both unset (aider's own `--auto-test` loop calls this with neither set), scopes them from this seat's own BL-1697 driver record (`local_parcel_driver_cli.bb test-scope`, BL-1699 requirement 4) when one exists naming a ticket; runs unscoped otherwise, exactly BL-1696's original behaviour | passthrough, or 2 if unconfigured |

A refused invocation always prints a usage line and exits **2**, with
nothing run and the tree unchanged. An unknown verb's usage line lists the
running role's own allowed verbs.

## The draft path (Article 2.2)

`note` and `handoff` write their draft where the article says for the
running role:

- `<checkout>/tmp/handoff.txt` for a worktree role.
- `swarmforge/runtime/handoff-draft.txt` for a master-resident role
  (`coordinator`, `specifier`).

## Argument rules

- A **role** argument must name a role present in the live
  `.swarmforge/roles.tsv`.
- A **ticket** argument must match `BL-<digits>`.
- A **sha** argument must be 7–40 hex characters and resolve to a real
  commit object.
- A **priority** argument must be exactly two digits.
- **Text** arguments must be non-empty and must not contain a dollar sign,
  a backtick, a backslash, or a double quote; a `note` message is also
  capped at 80 characters.

No caller-supplied text is ever sanitized or escaped into a shell command
string — forbidden characters are refused outright, and every allowed
value still reaches its script as one argv element.

## Per-role verb sets

- `coder`, `cleaner`, `architect`, `hardender`, `documenter`, `QA`: all
  seven verbs.
- `coordinator`: `next`, `done`, `ask`, `note` only.
- Any other role, including an unset `SWARMFORGE_ROLE`: none.

The coordinator's remaining verbs from the source intake
(`main-sync`, `ff-main`, `freshness`, `close`, `promote`, `stage-sync`) are
deliberately not part of this vocabulary yet — they wait on the local
pack-shape ruling (BL-1702), so no local seat can be handed surface no
model may ever need to type.

## Out of scope here

The local parcel driver that calls `seat` (BL-1697), and any change to
Claude seats or packs. Aider launch and bootstrap text (BL-1699) is
documented in
[BL-1697's how-to](../how-to/BL-1697-local-parcel-driver.md#what-an-aider-seat-receives-at-launch-bl-1699).

See also: [Non-Pipeline Agents — Reference Table](BL-643-non-pipeline-agents-reference-table.md).
