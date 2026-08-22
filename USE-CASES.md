# Use Cases

This inventory lists the capabilities this application supports today, derived
from the target's own code. Cite an entry by its name when raising a change
request against it.

## Swarm launch and tiled agent panel

Launch a SwarmForge swarm against a target repo via ./swarm and watch each pipeline role's tmux pane live in an interactive VS Code webview tile.

Implemented in:
- extension/src/bridge
- swarm

## Pipeline handoff protocol

Structured git_handoff/note/rule_proposal messages move parcels through the specifier->coder->cleaner->architect->hardener->documenter->QA chain via swarm_handoff.sh/ready_for_next.sh, with QA landing approved commits on main and the coordinator doing backlog bookkeeping.

Implemented in:
- swarmforge/scripts
- swarmforge/handoff-protocol.md

## Remote/companion access

A Bubble Android app and Telegram-based messaging front desk let an operator watch and nudge the swarm away from the IDE.

Implemented in:
- android/app/src/main/java/com/swarmforge/floatcompanion
- extension/src/tools/telegram-front-desk-bot.ts

## Backlog governance and quality gates

Coordinator promotes paused backlog tickets into active work under a depth cap, health-based circuit breaker, and onboarding-contract gate; hardener/QA enforce coverage, mutation, and CRAP thresholds before merge.

Implemented in:
- backlog
- swarmforge/scripts/backlog_depth_lib.bb
- swarmforge/constitution/articles
