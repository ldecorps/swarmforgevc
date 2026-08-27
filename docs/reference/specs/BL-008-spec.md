# BL-008 Spec: Named runs — branch naming, JSONL run log, panel Recent Runs section

## Context

Partial implementation exists. Three gaps remain:

1. **Branch naming** — run name not passed to swarm script
2. **Run log format/location** — currently `globalStorageUri/runs.json` (JSON array); spec requires `~/.swarmforge/runs.jsonl` (one JSON object per line)
3. **Panel "Recent runs" section** — currently only a `showRuns` QuickPick command; spec requires a panel section

---

## Gap 1: Pass run name to swarm as branch

### Where
- `extension/src/swarm/swarmLauncher.ts` — `launchSwarm(targetPath)`

### Change
Add a `runName` parameter. When non-empty, set env var `SWARM_RUN_NAME=swarm/<runName>` on the spawned process. The swarm script reads this to name the branch.

```ts
export async function launchSwarm(targetPath: string, runName?: string): Promise<LaunchResult>
```

In the `cp.spawn` env block:
```ts
env: {
  ...process.env,
  SWARMFORGE_TERMINAL: 'none',
  ...(runName ? { SWARM_RUN_NAME: `swarm/${runName}` } : {}),
},
```

Update caller in `extension.ts` to pass `runName.trim()` to `launchSwarm`.

### Blank name default
If the user clears the input box, generate a timestamp-based default: `run-YYYYMMDD-HHMM` (local time). Do not require non-empty input — change `validateInput` to allow blank (the extension fills in the default).

---

## Gap 2: Run log at `~/.swarmforge/runs.jsonl` in JSONL format

### Where
- `extension/src/runs/runLog.ts`
- `extension/src/extension.ts` — `runLogPath`

### Changes

**runLog.ts** — rewrite to use JSONL:
- `appendRun`: write one `JSON.stringify(entry) + '\n'` line (append, not rewrite)
- `loadRuns`: read file line-by-line, parse each non-empty line, return array (newest-last)
- `updateLastRunForTarget`: read all lines, update matching entry, rewrite the file
- Keep `RunEntry` interface; add optional `status?: 'running' | 'stopped'` field

**extension.ts** — change `runLogPath`:
```ts
const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
```
Add `import * as os from 'os';`. Remove the old `globalStorageUri`-based path.

---

## Gap 3: "Recent runs" panel section

### Where
- `extension/src/panel/webviewHtml.ts` — add section to HTML
- `extension/src/panel/swarmPanel.ts` — send run data to webview
- Webview message handler — render section

### Behavior
- Show up to 10 runs, newest first
- Each row: name, target path (basename), date (`YYYY-MM-DD`), status badge (`running` or `stopped`)
- A run is `running` if its `targetPath` equals the currently configured target AND the swarm is currently active (use existing swarm state)
- Section is hidden when run log is absent or empty
- Refreshes on the same 5-second polling cadence as pipeline status

### Data flow
`SwarmPanel` reads the run log (up to 10 newest entries, reversed) and includes it in the periodic state message sent to the webview:

```ts
{ type: 'update', roles: [...], pipelineStage: ..., recentRuns: RunEntry[] }
```

Webview renders a `<div id="recent-runs">` section below the pipeline status.

### HTML/CSS
Simple table or list. Status badge: green `●` for running, grey `●` for stopped. No editing — read-only.

---

## Acceptance criteria (from BL-008.yaml)

- [ ] Launch prompts for a work-item name; blank → timestamp default
- [ ] Swarm receives `SWARM_RUN_NAME=swarm/<name>` env var
- [ ] Each launch appends one JSON line to `~/.swarmforge/runs.jsonl`
- [ ] Panel shows "Recent runs" section with up to 10 runs (newest first)
- [ ] Each row: name, target path, date, running/stopped badge
- [ ] Run log file created on first launch if absent (mkdir -p)

## Out of scope

- Do not implement actual branch creation inside the extension — the swarm script handles that via the env var
- Do not change the `showRuns` QuickPick command — keep it as-is alongside the new panel section
