#!/usr/bin/env bash
# BL-1363 hardener: surgical mutation sweep over close_ticket.sh (BL-149
# cooldown gate reads DECISION run). No Babashka/shell mutation tool wired
# (Startup Tools) - BL-638/BL-567 hand-authored fallback. Targets the
# safety-critical invariants: never fall through to a raw commit on a
# refusal (BL-1028, the exact defect this ticket exists to avoid), never a
# partial close (Article 2.6), never move a ticket with no resolvable
# destination.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET=swarmforge/scripts/close_ticket.sh
E2E=swarmforge/scripts/test/test_bl1363_close_ticket.sh

BACKUP="$(mktemp)"; cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; }

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

MUT_DIR="$(mktemp -d)"
trap 'restore; rm -f "$BACKUP"; rm -rf "$MUT_DIR"' EXIT
write() { printf '%s' "$2" >"$MUT_DIR/$1"; }

mutate() {
  local label="$1" fromfile="$2" tofile="$3" reason="${4:-}"
  restore
  if ! python3 - "$TARGET" "$fromfile" "$tofile" <<'PY'
import sys
p, af, bf = sys.argv[1], sys.argv[2], sys.argv[3]
a = open(af).read()
b = open(bf).read()
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    SKIPPED+=("$label"); skipped=$((skipped+1)); return
  fi
  if ! bash "$E2E" >/dev/null 2>&1; then
    echo "  killed   $label"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $TARGET (BL-1363 closing a ticket)"

# 1. Integrity-refusal check dropped: INTEGRITY_RC != 0 never noticed, so a
#    refused close falls through to reporting success anyway - the exact
#    BL-1028 failure this ticket exists to avoid.
write from1 'if (( INTEGRITY_RC != 0 )); then'
write to1   'if false; then'
mutate "integrity-refusal check dropped (falls through past a refusal)" "$MUT_DIR/from1" "$MUT_DIR/to1"

# 2. rollback_close removed from the refusal path: a refused integrity
#    commit would leave the git mv staged/renamed with nothing reversed.
write from2 '    REASON="$(integrity_refusal_reason \
      "$CLOSE_SNAPSHOT_DIR/integrity.out" "$CLOSE_SNAPSHOT_DIR/integrity.err")"
    rollback_close'
write to2   '    REASON="$(integrity_refusal_reason \
      "$CLOSE_SNAPSHOT_DIR/integrity.out" "$CLOSE_SNAPSHOT_DIR/integrity.err")"
    :'
mutate "rollback_close dropped from the refusal path" "$MUT_DIR/from2" "$MUT_DIR/to2"

# 3. exit 1 dropped on integrity refusal: the script would report the
#    refusal but still exit 0, reading as success to any caller.
write from3 'echo "close_ticket: integrity commit REFUSED (${REASON}) for ${IDS[*]} — rolled the staged active → done rename back; nothing moved. NOT overriding a refusal with a raw commit (BL-1028)." >&2
    exit 1'
write to3   'echo "close_ticket: integrity commit REFUSED (${REASON}) for ${IDS[*]} — rolled the staged active → done rename back; nothing moved. NOT overriding a refusal with a raw commit (BL-1028)." >&2
    :'
mutate "exit 1 dropped on integrity refusal (reports refused but exits 0)" "$MUT_DIR/from3" "$MUT_DIR/to3"

# 4. multiple-match refusal dropped: an ambiguous id (more than one file in
#    active/) would silently close whichever file glob-matched first.
write from4 'if (( ${#MATCHES[@]} != 1 )); then'
write to4   'if false; then'
mutate "multiple-match refusal dropped (ambiguous id silently resolved)" "$MUT_DIR/from4" "$MUT_DIR/to4"

# 5. missing-milestone refusal dropped: a ticket with no milestone: field
#    would resolve to backlog/done// (empty path segment) instead of
#    refusing - invariant 2's own named hazard.
write from5 'if [[ -z "$MILESTONE" ]]; then'
write to5   'if false; then'
mutate "missing-milestone refusal dropped" "$MUT_DIR/from5" "$MUT_DIR/to5"

# 6. git-mv-failure check dropped: a failed rename (e.g. a locked/missing
#    path) would be silently ignored and the loop would continue as if
#    every id moved - the structural partial-close guarantee broken.
write from6 'if ! git -C "$ROOT" mv "${RELSRCS[$i]}" "${RELDESTS[$i]}" 2>"$CLOSE_SNAPSHOT_DIR/mv.err"; then'
write to6   'if false; then'
mutate "git-mv failure check dropped (a failed rename goes unnoticed)" "$MUT_DIR/from6" "$MUT_DIR/to6"

echo "----"
echo "mutants: killed=$killed survived=$survived equivalent=$equivalent skipped=$skipped"
if [ "$survived" -gt 0 ]; then
  echo "SURVIVORS:"; printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  echo "SKIPPED (stale anchors, unrun):"; printf '  %s\n' "${SKIPPED[@]}"
fi
echo "ALL MUTANTS KILLED (or accepted-equivalent, see EQUIV lines above)"
