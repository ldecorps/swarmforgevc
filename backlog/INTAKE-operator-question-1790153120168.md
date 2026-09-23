# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-23T08:45:20.168985334Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Add ollama as an ancillary process managed by the swarm start/stop scripts, and make sure the daemon can clean up after it when it crashes or leaves ghost processes. (Human ask, 2026-09-23, LOCAL_AGENT topic, verbatim.)

Operator grounding (checked live this morning):
- ollama serve is HAND-STARTED and unsupervised: bash -lc "OLLAMA_MODELS=/mnt/d/dev/ollama/models /mnt/d/dev/ollama/bin/ollama serve", pid 6101, parented by WSL /init. There is no systemd on this box, so there is no unit and no Restart=always.
- No supervisor mentions ollama at all: babysitterd, handoffd_supervisor, operator_runtime, cursor_bridge_supervisor and front_desk_supervisor are all ollama-blind. The only auto-start in the tree is launch_local_agent.sh:40-41 (probe the endpoint, nohup ollama serve), which is the local-agent server path and NOT the swarm packs. modelServing.ts only COMPOSES an "ollama serve" string for the named-model CLI; it is a planner, not a supervisor.
- The ollama pack launch gates never probe the endpoint: start-swarm-ollama-ista-iq3s.sh checks only that ollama and aider are on PATH. So a dead server passes every gate and each aider seat then fails at its first request. The only two places that probe :11434 first are recruiter_weekly.sh and the compliance battery.
- No reaper reclaims ollama: grepping "ollama" across every reaper/janitor/cleanup/kill script returns nothing, kill_all_swarm.sh included. orphan_agent_reaper is scoped to SwarmForge-* remote-control agents, fixture_reaper to test fixtures, orphan_janitor to operator_runtime/node/vitest/caffeinate leftovers. model_steward_evict.py is a DISK janitor for unfit weights, not a process reaper.
- Ghosts are real, not hypothetical: right now a detached "ollama run hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S" (pid 23398) and a llama-server worker (pid 15871, ~11.6GB RSS) are alive outside all swarm bookkeeping. Only ollama's own keep-alive TTL unloads a worker.

Wanted: ollama becomes a first-class ancillary - started and endpoint-probed by the swarm start path, stopped and reaped by the stop path and by kill_all_swarm, gated at launch so a dead :11434 refuses the launch instead of passing it, and swept for orphaned llama-server / "ollama run" children by the janitor the same way orphan_janitor already sweeps other leaked ancillaries.
