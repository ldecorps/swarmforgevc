# INTAKE: The extension dev-host launcher is macOS-only — it cannot start the extension on Linux/WSL

**Raised by:** the human (ldecorps), 2026-07-14.
**Relayed via:** a Claude Code session that was asked to start the extension on
the Linux/WSL box and found it structurally impossible. Human-raised
("write up that ticket for the Linux launcher"); the relay is transport,
not authorship.

## The defect

`extension/scripts/start-extension-dev.sh` → `start-extension-dev.js` is the
one and only programmatic way to bring up the Extension Development Host, and
every stage of its launch path is macOS-specific:

- `start-extension-dev.js:23` — `VSCODE_APP` defaults to
  `/Applications/Visual Studio Code.app`, a macOS bundle path.
- `start-extension-dev.js:67-68` — the `vscode-not-found` stage hard-fails when
  that path is missing, so on Linux the script dies before it ever tries to
  launch anything.
- `start-extension-dev.js:112-121` — the launch trigger is `open -a "Visual
  Studio Code" <workspace>` followed by an **AppleScript keystroke**
  (`osascript` … `key code 96` = F5) to fire the "Run Extension" launch
  configuration. Neither `open` nor `osascript` exists on Linux.

The consequence is not just "the convenience script doesn't work". Because
`swarmforge/scripts/swarm_ensure.bb:47-49` wires `extension-bounce-cmd`
straight to this script, **`./swarm ensure`'s extension component can never
repair the dev host on a Linux/WSL host** — it can only ever report FAILED.
The health probe (`checkExtensionHealth.js`) is already cross-platform and
reports honestly; it's the *repair* half of the loop that is dead.

Observed 2026-07-14 on the WSL box: `checkExtensionHealth.js` → `UNHEALTHY`,
no `.dev-activation.json` marker, and no supported way to fix it from a shell.
The only way to start the extension there today is for a human to open
`extension/` in the VS Code GUI and press F5 by hand — which defeats the
purpose of a bounce script and blocks any headless or remote-controlled
recovery of the extension.

Note the environment also can't be worked around by pointing `VSCODE_APP` at
the Windows VS Code: on this box WSL's Windows-interop binfmt handler is not
registered (`/proc/sys/fs/binfmt_misc/WSLInterop` absent), so Windows `.exe`s
cannot be executed from the WSL shell at all (`Exec format error`). A real fix
has to launch a **Linux-native** VS Code.

## The ask (shape, not spec — specifier owns the spec)

Make the dev-host launcher work on Linux/WSL, so that
`start-extension-dev.sh` and therefore `./swarm ensure` can bring the
extension to health with no human at a keyboard.

The seam that looks right: **stop simulating an F5 keypress entirely.** VS Code
supports launching an Extension Development Host directly from the CLI —
`code --extensionDevelopmentPath=<ext-dir> <folder>` — which needs no GUI
automation, no AppleScript, and no window focus. If that works, it is a better
mechanism on macOS too, and the platform-specific `open`/`osascript` branch can
be retired rather than merely duplicated for Linux.

Desired behavior:

- On Linux/WSL, `start-extension-dev.sh` locates a Linux VS Code (`code` on
  PATH, honouring a `VSCODE_APP`/`VSCODE_BIN`-style override) and launches the
  dev host without any GUI keystroke automation.
- The script's existing contract is preserved exactly: exit 0 **only** after a
  fresh `.dev-activation.json` activation marker is observed (never a blind
  delay), each failure exits non-zero naming its stage, and a successful run
  ends with exactly one dev host on the freshly compiled build.
- `./swarm ensure`'s extension component can genuinely report FIXED on Linux,
  not just FAILED.
- macOS keeps working — ideally via the same CLI path, so there is one launch
  mechanism rather than two.
- A missing/unusable VS Code still fails loudly and specifically (the
  `vscode-not-found` stage keeps its meaning), rather than hanging until the
  activation timeout.

## Acceptance signals (suggestions for the specifier)

- On the Linux/WSL box, with the extension not running:
  `./extension/scripts/start-extension-dev.sh` exits 0 and
  `node extension/scripts/checkExtensionHealth.js` then prints HEALTHY.
- Running it a second time terminates the old dev host and still ends with
  exactly one — the idempotence property BL-058 established.
- `./swarm ensure` on that box reports the extension component HEALTHY/FIXED
  rather than FAILED.
- The macOS path is not regressed.

## Prior art / related

- **BL-058** — the original robust extension bounce script; this item extends
  its contract to a second platform without weakening it.
- **BL-145** — `./swarm ensure`; its extension component is the thing currently
  unable to self-heal on Linux.
