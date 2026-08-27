#!/usr/bin/env bash
# BL-317 E2E procedure item (e): every existing backlog/{active,paused,done}
# ticket (none of which declare roles: yet) must still read as the full
# standard chain, unchanged - a real-data regression guard against the
# "notes: prose that happens to mention the word roles:" false-positive
# risk the pure unit tests only check with one hand-crafted fixture.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB="$REPO_ROOT/swarmforge/scripts/routing_manifest_lib.bb"

fail=0
checked=0

while IFS= read -r -d '' f; do
  checked=$((checked + 1))
  out="$(bb -e "(load-file \"$LIB\") (println (routing-manifest-lib/read-roles (slurp \"$f\")))")"
  if [[ "$out" != "[specifier coder cleaner architect hardender documenter QA]" ]]; then
    echo "FAIL: $f read back as: $out" >&2
    fail=1
  fi
done < <(find "$REPO_ROOT/backlog" -name '*.yaml' -print0)

if [[ "$checked" -eq 0 ]]; then
  echo "FAIL: no backlog ticket files found to check" >&2
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "PASS: all $checked real backlog tickets (none declaring roles:) read as the full standard chain"
