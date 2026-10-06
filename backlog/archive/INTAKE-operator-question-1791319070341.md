# Intake: a question the Operator could not answer

Filed by the Operator (2026-10-06T20:37:50.342533048Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

DEFECT (human-reported cause of the 20:33Z total swarm death): "Some unit test execution killed the server again." A unit-test run reached the LIVE tmux server and killed it - 4th total tmux-server death today. Operator healed it with ./swarm ensure (rc=0, 3s, 10/10 panes dead=0 at 20:34:36Z); this is the CAUSE report, not a request to restart anything.

EVIDENCE: (1) Death window is tight - my own operator.log line at 20:30Z recorded the swarm HEALTHY (10/10 panes, handoffd heartbeat 20:28:54Z, HEAD 49fe963c76); SWARM_CONTROL_LOST fired by 20:33Z; 'no server running on .swarmforge/tmux/1523266553.sock' with ZERO seat processes left, while handoffd/babysitterd/operator_runtime all stayed alive - i.e. the tmux SERVER was killed, the daemons were not. (2) The newest vitest run on the box finished 20:27:21Z, ~3-6 min before the window. CAVEAT, do not over-trust the attribution: .worktrees/expedite-BL-1310/extension/node_modules is a SYMLINK to the master root's node_modules, so that vitest results.json is a SHARED cache and its mtime cannot distinguish the master root from that worktree - it proves a run happened, not where from. (3) extension/test/stop.test.js is clean at HEAD and uses installInProcessTmux fakes + mkdtemp roots, so it is NOT the obvious culprit; the killer is some OTHER test that spawns the REAL tmux binary against a socket resolved from a live root.

WHY THIS IS NOT ALREADY COVERED: hotfixes a9cadb6484 + 49fe963c76 (stamp-off BL-2052) fixed the PRODUCTION kill paths - kill_all_swarm.sh and the extension stopper following a worktree's .swarmforge/tmux-socket pointer to the live server. They did not fix the TEST side. This is the same class one layer out: a test exercising a kill/stop/reap path resolves a live socket pointer instead of a fixture one. Related prior art worth reading before re-deriving: BL-1904/BL-1905 (a step handler running the REAL dispatcher from a fixture took up the LIVE role's parcel) and BL-1897 (TMPDIR inside a checkout made unit fixtures COMMIT into the real repo) are the same root shape - a fixture that fails to isolate from the live root.

WHAT IS WANTED: find the test(s) that can reach a live tmux socket and make that structurally impossible, not merely fixed in the one file found. Candidate surfaces already grep-visible: extension/test/{tmuxReaperGuard,bl1032TmuxReaperScope.property,stop,telegramCursorOperatorExec}.test.js and specs/pipeline/steps/bl{817FixtureTmuxServersReaped,1018SingleRoleRepairNeverKillsServer,486ReapOrphanedAgentProcesses,1305FixtureAgentBinary}Steps.js. A guard that FAILS a test which resolves a socket outside its own fixture root would stop the whole class; note my standing finding that the kill-all audit log reads as a FALSE NEGATIVE under a fixture root, so the audit log is not a usable detector here. Priority judgement is the coordinator's/specifier's, but note the cost: this has now cost 4 full-swarm deaths in one day.

## Disposition (specifier, 2026-10-06)

Specced as **BL-2053** (`backlog/paused/BL-2053-stamp-off-an-external-kill-never-reads-a-negative-pid-as-every-process.yaml`),
the stamp-off of hotfixes 48d037df88 and d0b9440211. The cause was not a test
reaching the live tmux socket: procps-ng 4.0.4's `/usr/bin/kill` reads
`kill -SIG -<pid>` as kill(-<first digit of pid>), so a pid starting with 1
signals every process the user owns. bl965's property runner made that call;
it had just started at both the 19:38Z and the 20:32:56Z deaths (run by the
specifier's census, which no lane runs). The structural fix is a unit-lane
guard that fails any external kill exec of a negative pid without `--`.
