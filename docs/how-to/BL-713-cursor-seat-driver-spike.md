# Driving one pipeline seat with a Cursor agent (the spike CLI)

Slice A of the `swarm-intelligence-layer` epic's Cursor-staffing work (BL-712).
Proves, once, that a Cursor agent can hold a real pipeline role seat: it wakes,
runs `ready_for_next.sh`, does the stage's work, and forwards through
`swarm_handoff.sh` — with no human ferrying anything between the seat and the
swarm.

This is a spike, not the production path. `node out/tools/cursor-seat-spike.js`
is slice A's only live caller of the seat driver, and is expected to be
replaced by the real launcher path in BL-712 slice B. Nothing here changes what
`./swarm` launches, replaces a Claude seat, or changes what `/pilot` does.

## Run it

```sh
node extension/out/tools/cursor-seat-spike.js --role documenter
```

| Flag | Default | Meaning |
|---|---|---|
| `--role <role>` | *(required)* | One of the pipeline roles (`coder`, `cleaner`, `architect`, `hardender`, `documenter`, `QA`, …) |
| `--repo <path>` | current working directory | Repo root the seat's worktree is resolved under |
| `--provider <name>` | `cursor` | Identity provider recorded for certification lookup |
| `--model <id>` | `auto` | Model id recorded for certification lookup, and passed to the live Cursor session |
| `--agent <token>` | `claude` | Which already-registered agent's prompt bundle to compose the role under — the `cursor` launcher token itself doesn't exist yet (BL-712 slice B) |
| `--priority <nn>` | `50` | Handoff priority used when forwarding |

`--help`/`-h` prints usage and exits 0. An unknown flag, a flag with no value,
or a missing/unrecognized `--role` exits 64 without doing anything.

`CURSOR_API_KEY` must be set in the environment — the CLI refuses to open a
session without it.

### Exit codes

| Code | Outcome | Meaning |
|---|---|---|
| 0 | `forwarded` or `no_task` | The seat forwarded a handoff, or found an empty mailbox and stopped (it never polls a second time — the same "no re-poll" posture every role follows) |
| 1 | `aborted` | A helper call failed, or the session ended without a usable result |
| 2 | `refused_uncertified` | The identity was refused before anything else ran (see below) |
| 64 | *(parse error)* | Bad arguments |

## The certification gate

An identity not certified in the Model Steward registry
(`.swarmforge/model-steward/registry.json`) cannot staff a **production**
pack. This slice runs an uncertified `cursor/auto` identity by design —
certification and registration are BL-712 slice C, deliberately not folded in
here — so a real run needs the spike-only escape:

```sh
SWARMFORGE_CURSOR_SEAT_SPIKE=1 node extension/out/tools/cursor-seat-spike.js --role documenter
```

Only that exact value (`1`) flips posture to `spike`; anything else — unset,
empty, `0`, `true`, a stray leading space — stays `production` and refuses an
uncertified identity outright (fail-closed: an absent, malformed, or
statusless registry entry reads as `unknown`, refused the same as an explicit
non-certified candidate). Refusal happens before any prompt bundle is
composed, any session opened, or any helper called — nothing is written on a
`refused_uncertified` outcome.

## What it does, in order

1. Reads the Model Steward registry and resolves the identity's certification
   status; admits it or refuses per the gate above.
2. Resolves the role's worktree (`.worktrees/<role>`, or the repo root itself
   for the master-resident `coordinator`/`specifier` roles).
3. Composes the role's prompt bundle (`prompt_engine_cli.bb compose <agent>
   <role> 0`) and opens a live Cursor session with it.
4. Runs `ready_for_next.sh` in the role's worktree — exactly once. A non-task
   result (`NO_TASK` or similar) is reported and the run stops; it never polls
   again in the same invocation.
5. Hands the task to the session and waits for a structured stop reason (a
   completed run with a commit, a denied tool event, an error) — never by
   reading rendered pane text.
6. On a completed result naming a commit and task, writes
   `tmp/handoff.txt` in the role's worktree and runs `swarm_handoff.sh`
   against it, exactly like any other role.
7. Writes a transcript to
   `.swarmforge/cursor-seat/<role>-<timestamp>.transcript.md` and prints a
   report to stdout.

## Reading the report

```
cursor seat spike: forwarded
  role:      documenter
  posture:   spike
  reason:    forwarded to QA
  forwarded: QA
  transcript: .swarmforge/cursor-seat/documenter-20260823T001200Z.transcript.md
  decision:  forward <- stop_reason:completed (session reported a commit and task to forward)
```

A refusal prints the same shape with `outcome: refused_uncertified` and no
`forwarded`/`transcript` line (nothing ran, so there is nothing to point at).

## Boundary: what this slice is not

- **Not the launcher.** `./swarm` still only knows the existing agent tokens
  (`claude|codex|copilot|grok|aider|vibe|gemini`); adding `cursor` there is
  BL-712 slice B.
- **Not certification.** Registering a Cursor identity and running it through
  the compliance battery is BL-712 slice C. This slice's only path to running
  at all is the spike-only escape above.
- **Never a private side channel.** The seat reaches the swarm only through
  `ready_for_next.sh` and `swarm_handoff.sh` — the same two helpers every
  other role uses — and only ever writes its own worktree's `tmp/handoff.txt`
  and its own transcript file.

## Source layout

- `extension/src/swarm/cursorIdentity.ts` — Model Steward registry lookup,
  the spike-only escape, pack posture, and worktree binding
- `extension/src/swarm/cursorSeatProtocol.ts` — turning a session signal into
  a next-step decision, and building the outbound handoff draft
- `extension/src/swarm/cursorSeatSession.ts` — the live Cursor SDK session
  wiring (stream consumption, signal selection, commit resolution)
- `extension/src/swarm/cursorSeatWireFormat.ts` — parsing `ready_for_next.sh`
  output into a structured task
- `extension/src/swarm/cursorSeatDriver.ts` — the state machine
  (`runSeatOnce`) that ties the above together into one seat run
- `extension/src/tools/cursor-seat-spike.ts` — the CLI entry point described
  above; slice A's only live caller

Acceptance feature: `specs/features/BL-713-cursor-seat-driver-spike.feature`.
