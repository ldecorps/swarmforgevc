# The local parcel driver — moving a coder parcel through a local aider seat

**Last Updated:** 2026-09-24

A headless local (aider) seat has no command channel of its own — it never
runs a `!` line and auto-declines fenced shell blocks — so it cannot move a
pipeline parcel by itself. The **local parcel driver**
(`swarmforge/scripts/local_parcel_driver_lib.bb`) does that work instead:
it types every instruction, reads only git state and the model's own
`--llm-history-file`, and hands off a parcel only when the model's turn
provably fixed what it was told to fix. See
[`seat` — the command vocabulary it drives through](BL-1696-seat-command-vocabulary.md)
(read that first — this driver's every action is one `seat` verb).

## What makes a seat a driver seat

A seat is a **driver seat** when both hold:

- its agent's provider carries the parcel-driver capability
  (`prompt_engine_lib.bb`'s `parcel-driver-capable?`; `aider` today), and
- its role, stripped of a `@N` seat suffix, is one the driver drives — in
  this slice, `coder` (and `coder@2`, a mixed pack's second coder seat).

Any other seat — every Claude seat, and an aider seat in a role the driver
does not drive — is untouched: it keeps receiving handoffd's ordinary
new-mail wake, chase poke and in-process-resume injections exactly as
before.

## What an aider seat receives at launch (BL-1699)

No pipeline script — editable, read-only, or merely named — ever reaches
an aider seat's chat. Four pieces on the launch line and bootstrap text,
all in `swarmforge.sh`'s `aider` launch branch and
`prompt_engine_lib.bb`'s `aider-bootstrap-text`:

- **Role note, `--read`.** `swarmforge/roles/aider/<role>.note` — a few
  plain-language lines (this slice ships `coder.note`; every other role
  falls back to `generic.note`) — loads via `--read`, not `/add`: the
  model can see it but never edit it. No bootstrap step `/add`s the
  constitution, `PIPELINE.md`, or a role prompt for an aider seat (the
  old shape blew an 8k-token Ollama context window with files the seat
  never needed to see in full).
- **Bootstrap text names no path.** `aider-bootstrap-text` no longer
  mentions `ready_for_next.sh`, the handoff draft path, or any other
  repository path or `swarmforge/scripts` basename — aider auto-`/add`s
  every path a reply merely names, so naming one there made it an
  editable file with auto-commit on. It also drops the old "reply with
  `!`" instruction: aider never runs a model's `!` line (BL-1696), so
  that instruction was always inert.
- **Coder-only test loop.** Only a `coder`-role seat (its base role,
  stripped of a `@N` suffix) gets `--test-cmd 'swarmforge/scripts/seat
  test' --auto-test` on its launch line; every other aider role gets
  neither flag. When aider's own test loop invokes `seat test` this way,
  `SEAT_TICKET`/`SEAT_ACCEPTANCE` are not set in the environment (aider
  never sets them) — `seat` then reads this seat's own BL-1697 driver
  record for its running ticket and acceptance path; with no record (or
  no ticket in it yet), `seat test` runs unscoped, exactly as BL-1696
  left it.
- **Timeout.** A pack's `config aider_timeout_seconds <n>` becomes
  `--timeout <n>` on every aider launch line, any role; absent, no flag
  (aider's own default applies).

Claude seats' launch lines and bootstrap texts are untouched — this is an
aider-only change, gated the same way every driver-seat behaviour is:
by capability, never by a provider-name check sprinkled at each call site.

## What handoffd does differently for a driver seat

`handoffd.bb` runs `local-parcel-driver-sweep!` every cycle, advancing
every live driver seat by one `drive-tick!` — never blocking, only ever
doing as much as is ready that tick. For a driver seat, the daemon's three
own injection paths (new-mail wake, chase poke, in-process resume) are all
skipped: while the driver owns a seat's pane, every character typed into
it is the driver's own (invariant 2) — nothing else may write to it.

## The per-parcel sequence (`drive-tick!`)

State for one seat lives at `.swarmforge/local-driver/<seat-id>.json`,
keyed by seat id (never role — a mixed pack's `coder@2` gets its own state
file, independent of the Claude `coder`'s).

1. **Serve.** `seat next` claims the seat's own `in_process` parcel; the
   driver reads the claimed `.handoff` file directly (`from`, `commit`,
   `task`).
2. **Merge.** `seat merge <sender> <commit>`. A conflict (or any nonzero
   exit) escalates immediately with reason `"merge conflict"` — no
   instruction is ever typed.
3. **Red check.** `seat test` (with `SEAT_TICKET`/`SEAT_ACCEPTANCE` set)
   must FAIL. A pass here escalates `"acceptance passed before any edit"`
   — there is nothing for the model to fix, so none is asked to.
4. **Chat set.** The chat is cleared; the ticket YAML and its acceptance
   feature are `/read-only`'d in the chat **and** `chmod`'d physically
   unwritable (the `/read-only` command alone is advisory and gets
   auto-accepted under `--yes-always`, so the filesystem permission is the
   real protection). Every file the ticket names as editable — its own
   `## Scope` section's backtick paths, plus every `required_wiring`
   entry's file, minus anything under `swarmforge/scripts/`,
   `swarmforge/roles/` or `swarmforge/constitution/` (FIRM: never a
   pipeline script in a seat's chat) — is `/add`ed.
5. **One instruction**, typed raw (no aider no-narration suffix): *"implement
   `<BL-n>` exactly as the read-only ticket describes so the read-only
   acceptance passes; never edit a read-only file."*
6. **Idle wait.** Later ticks re-check the pane; once it returns to an
   empty prompt (tolerating aider's own multi-round `--auto-test` loop),
   the gate runs.
7. **Gate**, checked in this order (matches the ticket's own scenario
   table — "no commit" must never be reported as "acceptance still
   failing"):
   - a commit exists after the post-merge `HEAD`,
   - `seat test` now passes,
   - both spec files are byte-identical to their pre-turn hashes,
   - every path the new commit(s) touch is in the editable set from
     step 4 (aider auto-adds any path a reply merely names, so this is
     checked against real git state, never assumed from the chat).

   **All four hold** → spec write permission is restored, `seat handoff
   <next-role> <ticket>` (the next role from the ticket's own
   `required_stages`, never a literal `"cleaner"`) then `seat done`; state
   cleared.

   **Any fail, fix turns remaining** (`seat_fix_turns`, currently fixed at
   3 — not yet pack-configurable) → one fix request is typed naming the
   failed condition, and the gate runs again on the next idle tick.

   **Fail at the turn limit** → spec write permission is restored, `seat
   ask "<ticket>: <condition>"` is sent, and the state file is marked
   `escalated`. An escalated parcel stays `in_process` — releasing that
   hold is a separate ticket (BL-1698), not built here.

## What this driver does not do (yet)

- **Resume after a daemon/host restart**, releasing an escalated hold, and
  driving `note` parcels — all BL-1698.
- **Non-`coder` roles on a driver seat** — deferred to the BL-1702
  pack-shape ruling.
- Any Claude seat or pack — entirely untouched (capability-gated, never a
  provider-name check).

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1696 `seat` command vocabulary](BL-1696-seat-command-vocabulary.md) | The seven verbs this driver types through |
| [BL-1052 local model seat launch](BL-1052-local-model-seat-launch.md) | Staffing a seat with a local model in the first place |
| `docs/diagrams/handoff-flow.mmd` | The driver-seat per-tick loop, diagrammed alongside the ordinary handoff mechanism |

Acceptance:
`specs/features/BL-1697-the-local-parcel-driver-moves-a-coder-parcel-through-a-local-aider-seat.feature`,
`specs/features/BL-1699-aider-seats-launch-with-a-short-role-note-no-repo-paths-and-the-seat-test-loop.feature`.
