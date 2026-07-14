Feature: The extension dev host can be started from a shell on Linux, not only on macOS

# BL-361: `start-extension-dev.sh` -> `start-extension-dev.js` is the one and only programmatic way
# to bring up the Extension Development Host, and its whole launch path is macOS-only: a
# `/Applications/...` default, a hard fail when that path is absent, and an `open` + AppleScript
# `key code 96` (F5) keystroke to fire the "Run Extension" launch config. `swarm_ensure.bb` wires
# `extension-bounce-cmd` straight to it, so on the Linux/WSL host the swarm actually runs on,
# `./swarm ensure` can only ever report the extension component FAILED — the repair half of the
# loop is dead and the only fix is a human pressing F5 by hand.
#
# The seam: stop simulating a keypress. Launch the dev host by the editor's own command line
# (`--extensionDevelopmentPath=<ext-dir>`) on BOTH platforms, so there is one mechanism rather than
# two. The existing dev-host detection is already keyed to exactly that flag, so the health probe
# and the "exactly one dev host" property carry over unchanged.

# BL-361 linux-dev-host-launcher-01
Scenario Outline: The dev host is launched by the editor's own command line on every supported platform
  Given the host platform is <platform>
  And a usable VS Code is installed
  When the dev-host launcher runs
  Then VS Code is asked to open the extension in development mode
  And the launcher uses no GUI keystroke automation

  Examples:
    | platform |
    | linux    |
    | darwin   |

# BL-361 linux-dev-host-launcher-02
Scenario: Success is declared only once the extension has actually activated
  Given a usable VS Code is installed
  When the dev-host launcher runs
  Then it reports success only after observing a fresh activation marker

# BL-361 linux-dev-host-launcher-03
Scenario: Bouncing an already-running dev host still ends with exactly one
  Given a usable VS Code is installed
  And an older dev host is already running for this extension
  When the dev-host launcher runs
  Then it ends with exactly one dev host, on the freshly compiled build

# BL-361 linux-dev-host-launcher-04
Scenario: A VS Code that cannot run on this host fails loudly, and fails fast
  Given the only VS Code found cannot be executed on this host
  When the dev-host launcher runs
  Then it fails naming the stage that no usable VS Code was found
  And it does not wait out the activation timeout

# BL-361 linux-dev-host-launcher-05
Scenario: The operator can name which VS Code to launch
  Given the operator names the VS Code to use
  When the dev-host launcher runs
  Then the named VS Code is the one launched

# BL-361 linux-dev-host-launcher-06
Scenario: The swarm's own repair loop can bring the extension to health on Linux
  Given a usable VS Code is installed
  And the extension is not running on a Linux host
  When the swarm ensures its extension component
  Then the extension component is reported as repaired
