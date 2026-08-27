# Choose a Cursor seat

## When a Cursor seat is the right choice

Use a **Cursor seat** (`agent` token `cursor` on a pack `window` line, launched
via `cursor-agent`) when you want a live pipeline role — coder, cleaner,
architect, and so on — driven by Cursor in its own worktree, with the same
ready_for_next / handoff loop as every other provider seat.

| Choice | What it is | What it is not |
|--------|------------|----------------|
| **Cursor seat** | A live swarm role on `cursor-agent` | Not an offline expeditor |
| **`/pilot`** | Offline expeditor for a defect you already named | Not a live seat; does not staff a tmux window |
| **Claude seat** | Live role on Claude (default forge packs) | Different billing, tools, and cert posture |

`/pilot` remains the offline expeditor. It does **not** replace a Cursor
window line. Claude seats remain the default for packs that name `claude`.

## How to select the Cursor pack

A committed pack already names Cursor on window lines:

```text
swarmforge/packs/cursor-mono-router.conf
```

Launch (examples):

```bash
./start-swarm-cursor.sh
# or
SWARMFORGE_TERMINAL=none ./swarm <root> --pack cursor-mono-router
```

Identity must be certified (BL-1079) or you need the documented spike escape
`SWARMFORGE_CURSOR_SEAT_SPIKE=1`. Without that, the launcher refuses on
purpose — that is not the same as an unsupported-agent typo.

## If the launcher says the agent is unsupported

A misspelt or unknown agent token refuses with `Unsupported agent '…' for
role '…'`. That message also points here:

`docs/how-to/BL-1080-choose-a-cursor-seat.md`

Fix the pack `window` line (or `coordinator_agent`) to a supported token —
including `cursor` when you intend a Cursor seat — then relaunch.

Acceptance: `specs/features/BL-1080-a-pack-can-name-cursor-on-a-window-line.feature`
