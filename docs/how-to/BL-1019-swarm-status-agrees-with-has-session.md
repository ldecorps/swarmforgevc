# `./swarm status` agrees with session + agent-child liveness (BL-1019)

## The lie this fixed

`./swarm status` used to report every agent **DOWN** while the panes were
alive. Claude (or Cursor) runs as a **child** of the pane shell, so
`pane_current_command` is often `zsh`/`bash`. A check that trusted only that
string concluded the agent was down.

That made incidents unreadable: after a real attach miss, status looked the
same as the always-wrong healthy case.

## What status keys off now

Agent rows use the same three-state discrimination babysitter already uses
(session presence + agent process under the pane; gather failure is not
absence):

| Facts | Status |
| --- | --- |
| Session missing (`tmux has-session` fails) | **DOWN** (agrees with attach) |
| Session present, live agent child under pane | **UP** (even if pane command is zsh/bash) |
| Session present, no agent child | **DOWN** |
| Session present, process gather failed | **unknown** (never DOWN) |

Dormant mono-router roles still render as **DORMANT** when the session is
absent by design.

## Operator check

```bash
./swarm status .
# A role whose pane is up with a live agent child should show UP, not DOWN.
tmux -S "$(…socket…)" has-session -t <role-session>   # present ↔ not DOWN-for-missing
```

Acceptance: `specs/features/BL-1019-swarm-status-agrees-with-has-session.feature`.

Related: [babysitterd runbook](./BL-611-babysitterd-runbook.md),
[control-plane loss recovery](./BL-958-control-plane-loss-recovery.md).
