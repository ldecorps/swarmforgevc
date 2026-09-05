#!/usr/bin/env bash
# BL-1423 acceptance driver: reads the PARCEL's own tracked
# swarmforge/scripts/test tree and suite-manifest.tsv, and runs the real
# suite_inventory_cli.bb and run_bb_suite.sh --list against it. Read-only:
# no fixture copy, no test execution beyond the inventory gate and the
# --list enumeration, matching the ticket's own "the tree at this commit
# is the contract" framing - a copy would let the acceptance layer pass
# against a stale tree the send-time gates never saw.
#
# Usage: bl1423StandingSuiteRunsAgainCli.sh inventory
#        bl1423StandingSuiteRunsAgainCli.sh rows-for <file>
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TEST_DIR="$REPO_ROOT/swarmforge/scripts/test"
MANIFEST="$TEST_DIR/suite-manifest.tsv"

MODE="${1:?usage: bl1423StandingSuiteRunsAgainCli.sh <inventory|rows-for> [file]}"

case "$MODE" in
  inventory)
    OUT="$(bb "$TEST_DIR/suite_inventory_cli.bb" "$TEST_DIR" 2>&1)"
    EXIT_CODE=$?
    ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<< "$OUT")"
    printf '{"exitCode":%s,"output":%s}\n' "$EXIT_CODE" "$ESCAPED"
    ;;

  rows-for)
    FILE="${2:?usage: bl1423StandingSuiteRunsAgainCli.sh rows-for <file>}"
    ROWS_JSON="$(node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const manifest = process.argv[2];
      const lines = fs.readFileSync(manifest, "utf8").split("\n");
      const rows = lines
        .filter((l) => !l.startsWith("#") && l.trim().length > 0)
        .map((l) => l.split("\t"))
        .filter((cols) => cols[0] === file)
        .map((cols) => ({ name: cols[0], lane: cols[1] || "", date: cols[2] || "", reason: cols[3] || "" }));
      process.stdout.write(JSON.stringify(rows));
    ' "$FILE" "$MANIFEST")"
    # `grep -q` stops reading as soon as it finds a match, closing its end
    # of the pipe early; under this host's own heavy live-swarm contention
    # (measured load ~7-10 during authoring) that early close occasionally
    # raced run_bb_suite.sh's own write and was measured to drop the match
    # in ~1 of 8 runs. `grep -c` reads the WHOLE stream every time (0/30
    # measured misses) - the fix is reading fully, not retrying a partial
    # read.
    MATCH_COUNT="$(env -u TMUX bash "$TEST_DIR/run_bb_suite.sh" --list 2>/dev/null | grep -Fxc "$FILE")"
    LISTED=false
    [[ "$MATCH_COUNT" -gt 0 ]] && LISTED=true
    printf '{"rows":%s,"listed":%s}\n' "$ROWS_JSON" "$LISTED"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
