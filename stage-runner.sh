#!/usr/bin/env bash
# argv: <role> <ticket> <prompt-file> <verdict-file> <transcript>
set -euo pipefail
ROLE="$1"; TICKET="$2"; PROMPT="$3"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage $ROLE for $TICKET (prompt $(wc -c < "$PROMPT") bytes)" > "$TRANSCRIPT"
DIRECTIVE="$ROOT/.swarmforge/expedite-fixture/$ROLE.verdict"
if [[ -f "$DIRECTIVE" ]]; then
  cat "$DIRECTIVE" > "$VERDICT"
else
  echo '{"verdict":"pass"}' > "$VERDICT"
fi
