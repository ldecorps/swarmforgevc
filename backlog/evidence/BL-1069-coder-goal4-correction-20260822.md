# BL-1069 — goal 4 correction (coder)

Prompted by the specifier's priority-00 note ("goal4: tiles fine, largest
never wins. Record+stamp. F/u BL-1075"). The specifier is right and my
`BL-1069-coder-20260822.md` overstated the cost. Correcting the record before
it reaches a stage that would act on it.

## What I claimed, and what is actually true

I wrote that after an ensure sets `window-size largest`, "tiles lose their
configured rows until the panel re-applies". **That does not happen.**

Measured directly on a throwaway tmux server (not the swarm socket), tmux 3.7b:

```
1. manual + resize to 200x60 : 200x60
2. then window-size largest  : 200x60      <- unchanged
   capture-pane rows now     : 60          <- unchanged
3. manual + resize again     : 200x60
```

With **no client attached** — which is the swarm's own state, a headless
server the extension only ever reads through `capture-pane` — `largest` has no
client to size the window to, so it does not shrink an already-resized window.
The tiles keep their configured rows and the capture path returns the same
number of lines. Goal 4's answer is: **the tiles are unaffected, both in the
capture path and in their height.**

I reasoned from the extension's own comment ("tmux sizes windows to the latest/
attached client and snaps detached windows back to 80x24") without checking
whether it applies with zero clients. It does not. My fault for arguing from a
comment instead of measuring, on the one goal that asked me to weigh a real
effect.

## What still stands

The half of the finding that matters is unchanged, and is why a follow-up
exists at all: `harden_tmux_server` / `harden-server!` set `window-size
largest` on a server that `PaneTailer.applyPaneSettings()` puts back into
`window-size manual`, and `WINDOW_SIZE_MANUAL` is the exact tmux 3.4 crash
trigger. So the option half of the hotfix is not a safety net on a 3.4 server -
the extension re-arms the crashing state. It simply costs nothing either, which
is what I got wrong.

Also corrected: I described the panel as re-applying `manual` frequently. It
does not - `applyPaneSettings()` runs only when the socket changes or the ROLE
SET changes (`paneTailer.ts:275, :489, :510`), never on the ordinary poll. So
`largest` does stand on the server between role-set changes; it just has no
visible effect there, per the measurement above.

## Disposition

Stamped as reviewed, not as a defect in the landed hotfix. `window-size
largest` stays exactly as landed - scenario 03 requires it to still be set, and
this measurement removes the only cost I had attributed to it. Follow-up
tracked as **BL-1075** by the specifier.

Nothing in the BL-1069 parcel's code, tests or acceptance changes as a result -
this corrects an evidence claim only, and the parcel at e364cd7a4c stands.

By coder.
