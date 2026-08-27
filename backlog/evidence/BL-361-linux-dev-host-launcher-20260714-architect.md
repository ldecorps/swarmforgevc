# BL-361 linux-dev-host-launcher — 20260714 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `3a06f086e5` (coder commit `9ce5b13c03`) into the architect
worktree. `start-extension-dev.js`'s `triggerLaunch()` now runs
`<vscode-binary> --extensionDevelopmentPath=<ext-dir> <workspace>` on every
platform instead of the old macOS-only `open -a` + `osascript key code 96`
keystroke simulation. `bounceLib.js` gains two pure, injectable helpers:
`resolveVsCodeBinary` (platform default → bare `code` on PATH, `VSCODE_BIN`
override authoritative, gated on an injected `isExecutable` probe) and
`buildDevHostLaunchCommand`. `filterDevHostPids` (already keyed off
`--extensionDevelopmentPath=`) and the retry/timeout policy
(`decideNextStep`) are unchanged, correctly, since the new launch mechanism
still sets that same flag.

## Module boundaries — dependency-gate.js (REQUIRED HARD GATE)

Changed files (`extension/scripts/bounceLib.js`,
`extension/scripts/start-extension-dev.js`) are outside the
dependency-cruiser ruleset's scope (`.dependency-cruiser.cjs` rules all
match `^src/`; these live under `extension/scripts/`) — noted rather than
silently skipped, not run.

## Logical coupling — co-change-report.js

Ran against the 3 changed files. Only expected pairing at frequency 2
(the 3 files co-changing with each other, this ticket's own commit) plus
this ticket's own new step-file wiring; the long tail of `test/*.js` at
frequency 1 against `devBounceLib.test.js` is whole-suite-commit noise, all
below the tool's own default min-frequency (3). Nothing flagged.

## The WSL-cross-arch trap (ticket's own scenario 04)

Verified `isExecutable` is a real execution probe
(`spawnSync(binary, ['--version'], {stdio:'ignore'})` checking
`!result.error && result.status === 0`), not a PATH/stat check — this is the
exact seam the ticket calls out as load-bearing (a Windows `code.exe` is
resolvable on PATH in this box's WSL but cannot execute — missing binfmt
interop). `resolveVsCodeBinary` is synchronous throughout; a failed
resolution returns `{error: 'vscode-not-found', ...}` immediately rather
than falling through to the launch-retry/activation-timeout stages. Covered
directly by `devBounceLib.test.js`'s scenario-04 test and the acceptance
suite's own scenario 04.

## Testability

`main()`/`compile()`/`terminateOldDevHosts()`/`launchAndVerify()` are NOT
driven in-process by a test (no `require.main === module` guard exists here
either, pre-dating this ticket). `devHostLauncherSteps.js`'s own header
comment explains this deliberately: these functions spawn a real `npm
compile`, real `ps`/`kill`, and a real editor process with real-time polling
— the same "live process interaction" class the constitution's testable-
module boundary already excludes (comparable to tmux/PTY), not the same
family as the `tools/*.ts` `parseArgs`/`computeX` CLIs the CLI-thin-wrapper
rule (BL-233/262/272/350) targets. The genuinely new logic this ticket adds
(`resolveVsCodeBinary`, `buildDevHostLaunchCommand`) IS extracted as pure,
injectable, and IS tested in-process, both in `devBounceLib.test.js` and the
acceptance suite. Accepted as a reasoned, documented scope boundary rather
than a gap to bounce on.

## Verification run

- `npx vitest run test/devBounceLib.test.js` — 25/25 passed.
- `node specs/pipeline/cli.js specs/features/BL-361-linux-dev-host-launcher.feature`
  — 7/7 passed (6 scenarios, one a 2-example Scenario Outline).

No defect found. The live end-to-end proof (an installed Linux VS Code,
`./swarm ensure` reporting the extension HEALTHY/FIXED) is QA's e2e
procedure per the ticket's own notes, not reproducible here.

Forwarding to hardener.

By architect.
