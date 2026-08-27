# BL-010 Spec: Heartbeat Decorator

## Goal

Every agent tool call emits a timestamped heartbeat so the watchdog (BL-011)
can detect stalled or crashed agents without modifying agent code.

---

## Heartbeat file

One file per role, atomically overwritten on every tool entry and exit:

```
.swarmforge/heartbeats/<role>.yaml
```

Format:

```yaml
role: coder
pid: 12345
last_beat: "2026-06-29T21:40:01Z"
last_tool: write_file
phase: exit        # entry | exit
in_flight: false   # true between entry and exit beats
beat_count: 412    # lifetime count for this process; resets on respawn
```

### Atomic write rule

Full overwrite only — never in-place edit.  Write to `<role>.yaml.tmp` then
`rename()` to `<role>.yaml`.  This keeps the watchdog's read always consistent.

### `pid` field

The `pid` field is the OS process ID of the agent process (not the extension
host).  The watchdog uses it to distinguish "crashed" from "idle":
- File exists, PID not in `/proc/<pid>/` (or `kill -0 <pid>` fails) → crashed.
- File exists, PID alive, `in_flight: false`, `last_beat` stale → idle.
- File exists, PID alive, `in_flight: true`, age > `inFlightTimeoutSeconds` → stuck.

### `beat_count`

Per-process lifetime counter starting at `1`.  It resets to `1` on each new
process start (a respawned agent will show `beat_count: 1` vs the previous
agent's last count, making respawn visible in the watchdog).

---

## Where the decorator lives

`extension/src/tools/toolDecorator.ts` — wraps every tool exported from
`extension/src/tools/`.  Agents invoke tools through this layer; no tool calls
bypass it.

```ts
function withHeartbeat<T>(role: Role, toolName: string, fn: () => Promise<T>): Promise<T> {
  writeHeartbeat(role, toolName, 'entry', true);
  try {
    const result = await fn();
    writeHeartbeat(role, toolName, 'exit', false);
    return result;
  } catch (err) {
    writeHeartbeat(role, toolName, 'exit', false);   // clear in_flight even on error
    throw err;
  }
}
```

The `writeHeartbeat` call is synchronous (`fs.writeFileSync` via tmp+rename) to
guarantee the file is updated before the tool body runs or after it exits.

---

## Stuck in-flight recovery

If the agent process dies while `in_flight: true`, the heartbeat file stays with
`in_flight: true` indefinitely.  The watchdog detects this by checking the PID:

> `in_flight: true` **AND** `kill -0 <pid>` fails → treat as crashed, not as
> a legitimate long-running tool.

This prevents false "stuck tool" alerts caused by crashes.

---

## Acceptance criteria

- [ ] Call any decorated tool; confirm `<role>.yaml` is written with
      `phase: entry`, `in_flight: true` before the tool body runs.
- [ ] After the tool returns, confirm `phase: exit`, `in_flight: false`.
- [ ] Simulate a tool error (throw); confirm `in_flight: false` is written
      (decorator does not leave `in_flight` stuck on error).
- [ ] Confirm `beat_count` increments on each call within one process.
- [ ] Simulate a crash mid-tool (kill process): watchdog reads
      `in_flight: true` but PID is gone → classified as crashed, not stuck.
- [ ] The decorator is in `extension/src/tools/` only; no heartbeat code
      appears in agent files or the target project.
- [ ] Works for both the shell backend and the `vscode.lm` in-process runtime.

## Out of scope

- The watchdog logic that reads heartbeats belongs to BL-011.
- Do not add heartbeat polling or tile updates here.
