#!/usr/bin/env zsh
# BL-1330 acceptance driver (was BL-1326's until that ticket was retired as a
# duplicate at ab47a05670, which deleted this file on main; BL-1330's handler
# depends on it, so BL-1330 owns it now): EXECUTES the REAL extra_cli_targets_qwen_cloud
# from swarmforge/scripts/swarmforge.sh against each pack window's CLI tokens.
#
# The function is EXTRACTED from the live file and eval'd rather than copied
# here: a copy would drift from the shipped predicate silently, and this
# scenario's whole claim is about what the SHIPPED code does with the SHIPPED
# conf. Sourcing swarmforge.sh outright is not an option - it is the swarm
# launcher, and running it has side effects up to and including tearing down
# a live swarm.
#
# It is zsh, not bash: the predicate uses zsh word-splitting (${=extra_cli})
# and 1-indexed arrays, so running it under bash would silently answer the
# wrong thing.
#
# Usage: bl1330QwenRemapPredicateCli.zsh <swarmforge.sh path> <role|cli>...
# Prints one "<role> qwen-cloud|none" line per argument.
set -euo pipefail

script_path="$1"; shift

# The function's own text, from its opening line to its closing brace.
fn_text="$(awk '/^extra_cli_targets_qwen_cloud\(\) \{/{flag=1} flag{print} flag&&/^\}/{exit}' "$script_path")"
if [[ -z "$fn_text" ]]; then
  print -r -- "ERROR: extra_cli_targets_qwen_cloud not found in $script_path" >&2
  exit 2
fi
eval "$fn_text"

for spec in "$@"; do
  role="${spec%%|*}"
  cli="${spec#*|}"
  if extra_cli_targets_qwen_cloud "$cli"; then
    print -r -- "$role qwen-cloud"
  else
    print -r -- "$role none"
  fi
done
