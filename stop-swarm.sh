#!/usr/bin/env bash
mkdir -p .swarmforge/expedite-fixture
printf '%s\n' "$0 $*" >> .swarmforge/expedite-fixture/stop-invocations.log
echo "fixture stop: nothing to stop"
exit 0
