#!/usr/bin/env bash
# BL-1317: the Adapt-tier effort ladder is stated TWICE, in two languages
# that cannot import each other. The Adapt decision itself is Babashka only
# (swarmforge/scripts/seat_difficulty_lib.bb::adapt-effort-decision, reached
# through handoff_lib.bb::record-effort-adapt! at done_with_current_task.bb) -
# the 2026-09-02 spec amendment established there is no TypeScript caller at
# the adapt moment. But the RUNGS it moves between are BL-236's operator dial
# scale, extension/src/swarm/effortDial.ts::EFFORT_LEVELS, and that scale is
# still a separate literal on the other side of the boundary.
#
# A mirrored constant with a comment claiming the two agree is not a gate -
# that is exactly the class the Guardrails article names after BL-897. This
# file is the gate: it reads BOTH literals from their real sources and
# asserts they agree. A ladder that drifts on one side would silently give a
# seat a rung its other half has never heard of, and the drift would only
# surface as an unsupported effort flag at respawn.
#
# It also asserts the ladder is non-trivial in both directions: a one-rung
# ladder would make the whole class of drift untestable, and an agreement
# check over two empty lists passes for the wrong reason.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# ── the Babashka half, read from the real library ────────────────────────
BB_LADDER="$(bb -e '
(require (quote [babashka.fs :as fs]))
(load-file "'"$REPO_ROOT"'/swarmforge/scripts/seat_difficulty_lib.bb")
(println (clojure.string/join " " seat-difficulty-lib/adapt-effort-ladder))')"
BB_STREAK="$(bb -e '
(require (quote [babashka.fs :as fs]))
(load-file "'"$REPO_ROOT"'/swarmforge/scripts/seat_difficulty_lib.bb")
(println seat-difficulty-lib/adapt-default-clean-streak)')"

# ── the TypeScript half, read from the real module ───────────────────────
# The compiled module is preferred (it is what actually runs), with the
# source as the fallback so the guard still has something real to compare
# against in a tree that has not been compiled yet - never a hardcoded copy
# of the very literal under test, which would defeat the whole file.
TS_OUT="$REPO_ROOT/extension/out/swarm/effortDial.js"
if [[ -f "$TS_OUT" ]]; then
  TS_LADDER="$(node -e '
const m = require(process.argv[1]);
console.log(m.EFFORT_LEVELS.join(" "));' "$TS_OUT")"
else
  TS_SRC="$REPO_ROOT/extension/src/swarm/effortDial.ts"
  TS_LADDER="$(sed -n "s/.*EFFORT_LEVELS[^=]*= *\[\(.*\)\] *as const.*/\1/p" "$TS_SRC" \
    | tr -d "'\"," | tr -s ' ' | sed 's/^ *//;s/ *$//')"
fi

check "the Babashka ladder is non-empty" "[[ -n \"$BB_LADDER\" ]]"
check "the TypeScript dial scale is non-empty" "[[ -n \"$TS_LADDER\" ]]"
check "the ladder has more than one rung (a one-rung ladder cannot drift, so agreeing on it proves nothing)" \
  "[[ \$(printf '%s' \"$BB_LADDER\" | wc -w) -gt 1 ]]"
check "the Adapt ladder and BL-236's operator dial scale agree, rung for rung and in order (BL-897)" \
  "[[ \"$BB_LADDER\" == \"$TS_LADDER\" ]]"
check "the clean-streak default is greater than one (invariant 2's asymmetry is only real above one)" \
  "[[ \"$BB_STREAK\" -gt 1 ]]"

if [[ "$fail" -ne 0 ]]; then
  note "FAILED: BL-1317 effort ladder parity"
  exit 1
fi
note "ALL PASS: BL-1317 effort ladder parity"
