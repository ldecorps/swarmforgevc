Feature: Losing the control channel is never mistaken for every agent dying

# BL-368: when the tmux socket vanished (BL-367), the health sweep read `agents_running: 0` and
# enqueued EIGHT false AGENT_EXITED events — while all eight agents were alive and working. That is
# the single most dangerous signal in the system: the scripted recovery for it is to relaunch the
# roles, and relaunching would have spawned a SECOND set of eight agents onto the same worktrees as
# eight still-running ones — concurrent commits, racing merges, duplicated work. We were saved only
# because the disposable Operator that picked up those events reasoned its way to the truth (tmux
# server alive + role pids alive + handoffd heartbeat fresh ⇒ the agents are fine, the SOCKET is
# gone) and refused to relaunch. That correctness came from an LLM's judgment, not from a guardrail.
# It must not be load-bearing.

Background:
  Given the swarm is running with all its roles alive

# BL-368 control-loss-is-not-agent-death-01
Scenario: Losing the control channel is reported as control lost, not as agents dying
  When the swarm's control channel becomes unreachable while every agent is still alive
  Then the swarm reports that it has lost control of the swarm
  And it does not report any agent as having exited

# BL-368 control-loss-is-not-agent-death-02
Scenario: A role whose process is still alive is never relaunched
  Given the swarm believes a role has exited
  When it tries to start that role again
  Then it refuses, because that role's process is still running
  And no second agent is started on that role's worktree

# BL-368 control-loss-is-not-agent-death-03
Scenario: A genuinely dead agent is still detected and recovered
  Given a role's agent process has really died
  When the swarm checks the health of its roles
  Then it reports that role as exited
  And it recovers it

# BL-368 control-loss-is-not-agent-death-04
Scenario: Losing control of the swarm is surfaced loudly
  When the swarm loses control of its agents
  Then a human is told the swarm needs attention
