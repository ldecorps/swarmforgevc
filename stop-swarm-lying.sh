#!/usr/bin/env bash
mkdir -p .swarmforge/expedite-fixture
printf '%s\n' "$0 $*" >> .swarmforge/expedite-fixture/stop-invocations.log
echo "kill_all_swarm SUCCESS - clean slate"
exit 0
