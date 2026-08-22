# handoffd crash — ambulance `ticket-has-file?` race (2026-08-05)

**Died at:** 2026-08-05T14:11:24.144567Z  
**Failure log:** `.swarmforge/daemon/handoffd-failure-20260805T141124Z.log`  
**Supervisor posture:** BL-144 — alarm + halt, **no auto-restart** (intentional).

## Human ask (off-box)

Operator cannot SSH to the box. Death email only named the on-disk path. **Next time, attach `handoffd-failure-*.log` to the alarm email** so the full report is readable from mail/Telegram alone.

## Fatal exception

```
Type:     java.io.FileNotFoundException
Message:  …/backlog/active/BL-812-handoffd-cwd-breaks-mono-router-wake-remap.yaml
          (No such file or directory)
Location: swarmforge/scripts/ambulance_lib.bb:52:48
Stack:    handoffd/poll-once! → -main
```

`ticket-has-file?` does:

```clojure
(some #(= ticket-id (read-yaml-field (slurp (str %)) "id"))
      (fs/glob backlog-dir "**.yaml"))
```

`fs/glob` still listed the active path; between glob and `slurp`, BL-812 was moved to `backlog/done/M8/`. Uncaught → daemon exit → swarm halt.

## Preceding noise (not the throw)

~14:10:15Z — QA→coordinator outbox parcel `00_20260805T141014Z_000037_…` logged `error` then `already-archived`. Parcel later found under coordinator `inbox/abandoned/`. Messy delivery; **not** the FileNotFoundException.

## Mail snapshot at death

| role | inbox/new | outbox |
|------|-----------|--------|
| coder | 1 | 0 |
| cleaner | 1 | 0 |
| architect | 1 | 0 |
| hardender | 3 | 0 |
| documenter | 2 | 0 |
| QA / specifier / coordinator | 0 | 0 |

## Suggested fix shape (Host draft — specifier has last word)

1. **Death email attachment:** thread failure-log bytes through `alarm-and-halt!` → `send-configured-email!` attachments (BL-286 already supports Resend attachments for briefing diagrams; death path never uses them). Keep path line in body; say “full log attached.” Attach failure must never block halt.
2. **Ambulance harden:** wrap each `slurp` in `ticket-has-file?` with try/catch (skip vanished paths) so active→done mid-poll cannot kill handoffd. Unit-test the race.
3. **Non-goals:** do not re-enable auto-restart (BL-144 stands).

## Related plan / epic

- Epic parent: BL-539 (`swarm-reliability`)
- Sibling context: BL-812 (cwd wake remap — done); death-email attach is a new child.
