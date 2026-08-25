# Dev-host bounce under WSL: exactly one window (BL-578)

`extension/scripts/start-extension-dev.js` promises: after a successful
bounce there is **exactly one** Extension Development Host. Under WSL the
host is a Windows-side `Code.exe` window. Linux-only kill-old could not see
it, so every bounce **added** a window (six accumulated idle hosts observed
2026-07-23).

## What changed

1. **WSL kill-old** — after the Linux terminate step, bounce constructs a
   PowerShell `Stop-Process` seam (`bounceLib.buildWindowsKillOldCommands`)
   that stops Windows `Code` / `Code - Insiders` mains whose command line
   carries this `--extensionDevelopmentPath=…` (helpers with `--type=`
   skipped).
2. **Headless refuse** — if `.swarmforge/headless-swarm` is present, the
   bounce **exits non-zero** naming the marker. Pass `--force` to override
   (warns and proceeds). Defense in depth so headless deployments cannot
   re-accumulate windows when a caller bypasses `swarm ensure`'s skip.

Non-WSL kill-old is unchanged. Already-leaked windows are **not** cleaned
automatically — close them by hand once; this ticket prevents regrowth.

## Operator / developer

```bash
# Normal non-headless WSL bounce (from extension/)
node scripts/start-extension-dev.js

# Headless swarm present — refused unless forced
node scripts/start-extension-dev.js --force
```

After bounce: one Extension Development Host on the Windows taskbar for this
extension path. If a window reappears on a **headless** deployment without
`--force`, that is a new marker-bypass defect — not this ticket reopened.

Acceptance: `specs/features/BL-578-devhost-bounce-wsl-window-leak.feature`.
