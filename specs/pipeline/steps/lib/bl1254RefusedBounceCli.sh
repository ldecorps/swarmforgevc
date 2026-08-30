#!/usr/bin/env bash
# BL-1254 acceptance driver for scenario 04: the REAL expedite driver, over the
# REAL fixture repo, with a stage that returns a bounce carrying no actionable
# reason. Nothing is stubbed except the stage runner seam the driver already
# exposes (EXPEDITE_STAGE_RUNNER), so the refusal under review is the one the
# driver takes in production.
#
# Usage: bl1254RefusedBounceCli.sh <work-dir>
# Prints one JSON line:
#   {"exit":N,"refused":bool,"coderRuns":N,"cleanerRuns":N,"reEntered":bool,
#    "refusalLine":str}
set -uo pipefail

WORK="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$REPO_ROOT/swarmforge/scripts/expedite_cli.bb"
FIXTURE="$REPO_ROOT/swarmforge/scripts/test/expedite_fixture.sh"

R="$WORK/repo"
bash "$FIXTURE" "$R" --active BL-567 >/dev/null

# A bounce with a target but neither reason nor class: the shape 5de352ed1d
# refuses. Before it, this re-entered the coder and burned a bounce round.
cat > "$R/.swarmforge/expedite-fixture/cleaner.verdict" <<'JSON'
{"verdict":"bounce","target":"coder"}
JSON

OUT="$(EXPEDITE_STAGE_RUNNER="$R/stage-runner.sh" \
       EXPEDITE_STOP_CMD=./stop-swarm.sh EXPEDITE_START_CMD=./start-swarm.sh \
       bb "$CLI" "$R" BL-567 --no-restart 2>&1)"
code=$?

RAN="$R/.swarmforge/expedite-fixture/ran.log"
coder=$(grep -c '^coder$' "$RAN" 2>/dev/null || true)
cleaner=$(grep -c '^cleaner$' "$RAN" 2>/dev/null || true)
refused=false
grep -qF 'bounce-without-reason' <<<"$OUT" && refused=true
# Only the line that matters travels back; the rest of the driver log is
# thousands of characters of unrelated fixture noise.
refusal="$(grep -F 'REFUSE bounce-without-reason' <<<"$OUT" | head -1)"

export BL1254_EXIT="$code" BL1254_REFUSED="$refused" \
       BL1254_CODER="${coder:-0}" BL1254_CLEANER="${cleaner:-0}" \
       BL1254_REFUSAL="$refusal"
python3 -c '
import json, os
coder = int(os.environ["BL1254_CODER"])
print(json.dumps({
    "exit": int(os.environ["BL1254_EXIT"]),
    "refused": os.environ["BL1254_REFUSED"] == "true",
    "coderRuns": coder,
    "cleanerRuns": int(os.environ["BL1254_CLEANER"]),
    "reEntered": coder > 1,
    "refusalLine": os.environ["BL1254_REFUSAL"],
}))
'
