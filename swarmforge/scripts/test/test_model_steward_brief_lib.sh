#!/usr/bin/env bash
# BL-1815: model_steward_brief_lib.bb's timed wait/poll - the one behaviour
# model_steward_brief_lib_test_runner.bb's own process can't drive (env-set
# MODEL_STEWARD_BRIEF_WAIT_S/POLL_MS need a fresh subprocess). No tmux
# socket file exists in either fixture, so resolve-pane-target returns nil
# and request-brief! never attempts a real tmux call - it only waits on the
# filesystem.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../model_steward_brief_lib.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# 01: no brief ever appears -> "no brief" within roughly the stated bound.
WORK1="$(mktemp -d)"
register_tmp_dir "$WORK1"
START=$(date +%s%N)
OUT1="$(MODEL_STEWARD_BRIEF_WAIT_S=1 MODEL_STEWARD_BRIEF_POLL_MS=50 bb -e "
(load-file \"$LIB\")
(println (model-steward-brief-lib/request-brief! \"$WORK1\" \"coder\"))
")"
END=$(date +%s%N)
ELAPSED_MS=$(( (END - START) / 1000000 ))
check "no brief written -> classified as no brief" '[[ "$OUT1" == *"no brief"* ]]'
check "the wait is roughly the stated 1s bound (900-3000ms)" '[[ "$ELAPSED_MS" -ge 900 && "$ELAPSED_MS" -le 3000 ]]'

# 02: a brief written shortly after the call starts is picked up well
#     within a longer bound, and returns quickly (never waits out the bound).
WORK2="$(mktemp -d)"
register_tmp_dir "$WORK2"
mkdir -p "$WORK2/.swarmforge/agent-memory/coder"
( sleep 0.2; printf 'the outgoing seat'\''s brief' > "$WORK2/.swarmforge/agent-memory/coder/brief.md" ) &
WRITER_PID=$!
START=$(date +%s%N)
OUT2="$(MODEL_STEWARD_BRIEF_WAIT_S=5 MODEL_STEWARD_BRIEF_POLL_MS=50 bb -e "
(load-file \"$LIB\")
(println (model-steward-brief-lib/request-brief! \"$WORK2\" \"coder\"))
")"
END=$(date +%s%N)
wait "$WRITER_PID" 2>/dev/null || true
ELAPSED_MS=$(( (END - START) / 1000000 ))
check "a brief written within the wait is classified ok" '[[ "$OUT2" == *":ok true"* ]]'
check "the brief content round-trips" '[[ "$OUT2" == *"the outgoing seat'"'"'s brief"* ]]'
check "it returns well before the 5s bound (< 2500ms)" '[[ "$ELAPSED_MS" -lt 2500 ]]'

# 03: an empty brief file written SHORTLY AFTER the call starts (D1: a
#     pre-existing file at call time is cleared, so this must be written
#     after, like case 02) classifies as "empty brief", not "no brief".
WORK3="$(mktemp -d)"
register_tmp_dir "$WORK3"
mkdir -p "$WORK3/.swarmforge/agent-memory/coder"
( sleep 0.2; printf '   \n  ' > "$WORK3/.swarmforge/agent-memory/coder/brief.md" ) &
WRITER3_PID=$!
OUT3="$(MODEL_STEWARD_BRIEF_WAIT_S=1 MODEL_STEWARD_BRIEF_POLL_MS=50 bb -e "
(load-file \"$LIB\")
(println (model-steward-brief-lib/request-brief! \"$WORK3\" \"coder\"))
")"
wait "$WRITER3_PID" 2>/dev/null || true
check "a whitespace-only brief classifies as empty brief" '[[ "$OUT3" == *"empty brief"* ]]'

# 04: an over-budget brief written shortly after the call starts (same D1
#     reason as 03) classifies as "over 2000".
WORK4="$(mktemp -d)"
register_tmp_dir "$WORK4"
mkdir -p "$WORK4/.swarmforge/agent-memory/coder"
( sleep 0.2; python3 -c "print('x' * 2001)" > "$WORK4/.swarmforge/agent-memory/coder/brief.md" ) &
WRITER4_PID=$!
OUT4="$(MODEL_STEWARD_BRIEF_WAIT_S=1 MODEL_STEWARD_BRIEF_POLL_MS=50 bb -e "
(load-file \"$LIB\")
(println (model-steward-brief-lib/request-brief! \"$WORK4\" \"coder\"))
")"
wait "$WRITER4_PID" 2>/dev/null || true
check "a 2001-character brief classifies as over 2000" '[[ "$OUT4" == *"over 2000"* ]]'

# 05 (D1 regression): a brief.md ALREADY on disk before request-brief! is
# ever called - "left by an earlier boundary" - is never accepted as-is:
# it must be cleared, and since nothing rewrites it within the (short)
# wait, the call ends in "no brief", never the stale content.
WORK5="$(mktemp -d)"
register_tmp_dir "$WORK5"
mkdir -p "$WORK5/.swarmforge/agent-memory/coder"
printf 'OLD brief from last week'\''s trial' > "$WORK5/.swarmforge/agent-memory/coder/brief.md"
OUT5="$(MODEL_STEWARD_BRIEF_WAIT_S=1 MODEL_STEWARD_BRIEF_POLL_MS=50 bb -e "
(load-file \"$LIB\")
(println (model-steward-brief-lib/request-brief! \"$WORK5\" \"coder\"))
")"
check "a stale pre-existing brief is never accepted verbatim" '[[ "$OUT5" != *"last week"* ]]'
check "a stale pre-existing brief with no rewrite ends as no brief" '[[ "$OUT5" == *"no brief"* ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "ALL PASS"
  exit 0
else
  exit 1
fi
