#!/usr/bin/env bash
# BL-1025: an expedite run walks the same role hats with the swarm stopped,
# so its QA hat gives a real advance-or-bounce verdict but never merges into
# swarmforge-QA - nothing moves that ref offline. Every commit from BL-1021's
# expedite run therefore read as "landed outside QA" to the Article 4.2
# check on 2026-08-21. The predicate now reads the run's own durable verdict
# store as a SECOND approval path.
#
# The two rows that matter most, and the reason this file exists rather than
# a looser assertion: a commit whose MESSAGE claims an expedite run but has
# no verdict on file must still refuse (BL-972 - a self-report is not a
# gate), and a store that exists but cannot be consulted must fail CLOSED,
# never collapse into "no record found, therefore fine".
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
g commit -q --allow-empty -m seed
# swarmforge-QA is pinned HERE: every commit below is NOT an ancestor of it,
# exactly like an offline expedite run's commits.
g branch swarmforge-QA

mkdir -p "$ROOT/specs/pipeline/steps"
mk_commit() { # <file> <subject> -> echoes the sha
  printf '%s\n' "$2" > "$ROOT/specs/pipeline/steps/$1"
  g add -A
  g commit -q -m "$2"
  g rev-parse HEAD
}

APPROVED_SHA="$(mk_commit a.js 'expedite coder stage work')"
BOUNCED_SHA="$(mk_commit b.js 'expedite work the QA hat sent back')"
ABSENT_SHA="$(mk_commit c.js 'expedite work with no verdict recorded')"
SELF_REPORT_SHA="$(mk_commit d.js 'BL-999: landed via an expedite run, approved by its QA hat')"

STORE_DIR="$ROOT/.swarmforge/expedite-approvals"
mkdir -p "$STORE_DIR"
{
  printf '{"at":"2026-08-22T00:00:00Z","ticket":"BL-1021","stage":"QA","approval":true,"verdict":"pass","commit":"%s"}\n' "${APPROVED_SHA:0:10}"
  printf '{"at":"2026-08-22T00:01:00Z","ticket":"BL-1021","stage":"QA","approval":false,"verdict":"bounce","commit":"%s"}\n' "${BOUNCED_SHA:0:10}"
} > "$STORE_DIR/2026-08.jsonl"

run_predicate() { # <sha> -> sets OUT and EXIT_CODE
  set +e
  OUT="$(cd "$ROOT" && bash "$PREDICATE" "$1" 2>&1)"
  EXIT_CODE=$?
  set -e
}

# ── row 1: expedite QA hat APPROVED it ────────────────────────────────────
run_predicate "$APPROVED_SHA"
check "an expedite QA-hat approval on file reads as approved (exit 0) with no swarmforge-QA ancestry at all" \
  "[[ $EXIT_CODE -eq 0 ]]"

# ── row 2: expedite QA hat BOUNCED it ─────────────────────────────────────
run_predicate "$BOUNCED_SHA"
check "an expedite QA-hat BOUNCE verdict on file is a clean no (exit 1), never approval" \
  "[[ $EXIT_CODE -eq 1 ]]"

# ── row 3: no verdict anywhere ────────────────────────────────────────────
run_predicate "$ABSENT_SHA"
check "no verdict on file at all is a clean no (exit 1)" "[[ $EXIT_CODE -eq 1 ]]"

# ── row 5: the commit MESSAGE claims an expedite run, nothing on file ─────
run_predicate "$SELF_REPORT_SHA"
check "BL-972 guard: a commit whose SUBJECT claims an expedite run, with no verdict on file, is still a clean no" \
  "[[ $EXIT_CODE -eq 1 ]]"

# ── row 4: the store exists but cannot be consulted ───────────────────────
chmod 000 "$STORE_DIR/2026-08.jsonl" 2>/dev/null || true
run_predicate "$APPROVED_SHA"
UNREADABLE_EXIT=$EXIT_CODE
chmod 644 "$STORE_DIR/2026-08.jsonl" 2>/dev/null || true
# Running as root would make the file readable regardless; skip rather than
# assert something the environment cannot produce.
if [[ "$(id -u)" -eq 0 ]]; then
  note "skip - unreadable-store row cannot be produced as root"
else
  check "an UNREADABLE verdict store is undeterminable (neither 0 nor 1) - fails closed, never 'no record, therefore fine'" \
    "[[ $UNREADABLE_EXIT -ne 0 && $UNREADABLE_EXIT -ne 1 ]]"
fi

# A corrupt record line is the same class of undeterminable.
printf 'not json at all\n' >> "$STORE_DIR/2026-08.jsonl"
run_predicate "$APPROVED_SHA"
check "a CORRUPT record line makes the whole store undeterminable, never a silent approval" \
  "[[ $EXIT_CODE -ne 0 && $EXIT_CODE -ne 1 ]]"
printf '{"at":"2026-08-22T00:00:00Z","ticket":"BL-1021","stage":"QA","approval":true,"verdict":"pass","commit":"%s"}\n' "${APPROVED_SHA:0:10}" > "$STORE_DIR/2026-08.jsonl"

# An obstructed store directory is undeterminable too.
rm -rf "$STORE_DIR"
printf 'not a directory\n' > "$ROOT/.swarmforge/expedite-approvals"
run_predicate "$ABSENT_SHA"
check "an OBSTRUCTED store path (a file where the directory belongs) is undeterminable" \
  "[[ $EXIT_CODE -ne 0 && $EXIT_CODE -ne 1 ]]"
rm -f "$ROOT/.swarmforge/expedite-approvals"

# ── row 6 + the live pipeline is unchanged ────────────────────────────────
LIVE_SHA="$(mk_commit e.js 'work a live QA agent merged')"
g branch -f swarmforge-QA "$LIVE_SHA"
run_predicate "$LIVE_SHA"
check "a commit a live QA agent merged still reads approved with no expedite record at all" \
  "[[ $EXIT_CODE -eq 0 ]]"

# BL-952's veto must survive the new alternate path: a bounce on file wins
# over BOTH approval routes.
mkdir -p "$ROOT/.swarmforge/bounces" "$ROOT/.swarmforge/expedite-approvals"
printf '{"at":"2026-08-22T00:02:00Z","commit":"%s","by":"QA","role":"coder","failure_class":"correctness","ticket":"BL-1021"}\n' "${LIVE_SHA:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-08.jsonl"
printf '{"at":"2026-08-22T00:03:00Z","ticket":"BL-1021","stage":"QA","approval":true,"verdict":"pass","commit":"%s"}\n' "${LIVE_SHA:0:10}" \
  > "$ROOT/.swarmforge/expedite-approvals/2026-08.jsonl"
run_predicate "$LIVE_SHA"
check "a QA BOUNCE still vetoes, even with BOTH ancestry and an expedite approval on file (BL-952 survives)" \
  "[[ $EXIT_CODE -eq 1 ]]"

# ── D1 (architect bounce 2026-08-22): the reader must not re-derive the
#    writer's verdict vocabulary. The two live in different languages with no
#    import across the boundary, so a hand-copied token list drifts silently -
#    the hazard the Guardrails article names after BL-897, and the reason a
#    "kept in sync" comment is not a gate. This is that gate.
#
#    Structural, and in BOTH directions: the predicate must name none of the
#    verdict tokens, and the writer's vocabulary must remain plural (a
#    one-token set would make the whole class of drift untestable).
VOCAB="$(bb -e '
(require (quote [babashka.fs :as fs]))
(load-file "'"$SCRIPT_DIR"'/../expedite_lib.bb")
(println (clojure.string/join " " (map name (concat expedite-lib/advance-verdicts expedite-lib/bounce-verdicts))))')"
check "the writer's vocabulary is non-empty (a gate over an empty set proves nothing)" \
  "[[ -n \"\$(printf '%s' \"$VOCAB\" | tr -d '[:space:]')\" ]]"

leaked=""
for tok in $VOCAB; do
  if grep -qE "\"$tok\"|\($tok\||\|$tok\)|\|$tok\|" "$PREDICATE"; then
    leaked="$leaked $tok"
  fi
done
check "the predicate re-derives NO verdict token - the vocabulary has exactly one spelling, in expedite_lib.bb (BL-897/D1)" \
  "[[ -z \"$leaked\" ]]"

# And the positive half: EVERY advance token, driven through the REAL writer,
# produces a record the REAL predicate reads as approved. The first draft only
# ever exercised "pass"; `forward` and `approved` were never tested end to end,
# which is exactly what let the mirrored regex look correct.
for tok in $(bb -e '
(require (quote [babashka.fs :as fs]))
(load-file "'"$SCRIPT_DIR"'/../expedite_lib.bb")
(println (clojure.string/join " " (map name expedite-lib/advance-verdicts)))'); do
  VSHA="$(mk_commit "adv-$tok.js" "work advanced with the $tok verdict")"
  mkdir -p "$STORE_DIR"
  bb -e '
(require (quote [babashka.fs :as fs]) (quote [cheshire.core :as json]))
(load-file "'"$SCRIPT_DIR"'/../expedite_lib.bb")
(spit "'"$STORE_DIR"'/2026-08.jsonl"
      (str (json/generate-string
            (expedite-lib/qa-hat-verdict-record
             {:stage "QA" :verdict :'"$tok"' :ticket "BL-1025"
              :commit "'"$VSHA"'" :at "2026-08-22T00:00:00Z"})) "\n"))'
  run_predicate "$VSHA"
  check "the REAL writer's '$tok' verdict is read as approved by the REAL predicate (end to end, no hand-written record)" \
    "[[ $EXIT_CODE -eq 0 ]]"
done

if [[ $fail -ne 0 ]]; then
  note "FAILED"
  exit 1
fi
note "test_is_qa_ancestor_expedite_store: ALL CHECKS PASSED"
