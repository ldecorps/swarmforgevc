#!/usr/bin/env bash
# BL-1363: PROPERTY runner over the three invariants the ticket YAML declares
# (coder-authored first, per BL-654). Its own command, never folded into the
# unit lane.
#
#   P1 a refusal is OBEYED: whatever the batch, when the integrity CLI refuses,
#      every ticket is still in active/, the index carries nothing of this
#      close, and the reason is reported - never a raw commit fallback.
#   P2 all-or-nothing: for every batch, either EVERY id moved to its
#      milestone's done directory or NONE did. A partial close is unreachable.
#   P3 closing never promotes: the paused ticket is untouched in every case.
#
# EXHAUSTIVE over the shape that matters rather than sampled: the space is
# (batch size 1-3) x (0 or 1 unclosable id) x (integrity allows | refuses), and
# every cell is CONSTRUCTED - a random draw would essentially never produce a
# batch whose ids all resolve, which is the one shape that may close. Each cell
# asserts it was exercised.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PREFIX="bl1363-property-"

status=0
fail() { echo "FAIL: $*"; status=1; }
reached_move=0; reached_refuse=0; reached_partial=0; cells=0

rm -rf "${TMPDIR:-/tmp}/${PREFIX}"* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

build() {
  local cell="$1" size="$2" refuse="$3"
  root="$WORK/$cell"
  mkdir -p "$root/backlog/active" "$root/backlog/paused" "$root/backlog/done" "$root/swarmforge/scripts" \
           "$root/.swarmforge/handoffs/coordinator/inbox/completed" \
           "$root/.swarmforge/handoffs/coordinator/inbox/new" \
           "$root/.swarmforge/handoffs/coordinator/inbox/in_process"
  git init -q -b main "$root"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do
    g "$root" config "${kv%%:*}" "${kv##*:}" >/dev/null
  done
  cp -R "$REPO_ROOT/swarmforge/scripts/." "$root/swarmforge/scripts/"
  IDS=()
  local approval="QA-approved --"
  for ((i=1; i<=size; i++)); do
    local id="BL-93${i}0"
    printf 'id: %s\ntitle: fixture\nmilestone: M%s\nstatus: todo\n' "$id" "$i" \
      > "$root/backlog/active/$id-fixture.yaml"
    IDS+=("$id")
    approval="$id $approval"
  done
  printf 'id: BL-9399\ntitle: paused\nmilestone: M8\nstatus: todo\n' > "$root/backlog/paused/BL-9399-paused.yaml"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  printf 'from: QA\ntype: note\npriority: 00\nmessage: %s coordinator bookkeep\n\n%s\n' "$approval" "$approval" \
    > "$root/.swarmforge/handoffs/coordinator/inbox/completed/00_qa.handoff"
  if [[ "$refuse" == "refuse" ]]; then
    cat > "$root/swarmforge/scripts/commit_integrity_cli.bb" <<'BB'
#!/usr/bin/env bb
(println "{\"success\":false,\"reason\":\"property-refusal\"}")
(binding [*out* *err*] (println "FAILED (property-refusal)"))
(System/exit 1)
BB
  fi
  gq "$root" add -A && gq "$root" commit -m seed
}

for size in 1 2 3; do
  for bad in 0 1; do
    for refuse in allow refuse; do
      cell="c-$size-$bad-$refuse"; cells=$((cells + 1))
      build "$cell" "$size" "$refuse"
      args=("${IDS[@]}")
      [[ "$bad" == "1" ]] && args+=("BL-9998")   # constructed: an id that cannot close
      ( cd "$root" && bash "$root/swarmforge/scripts/close_ticket.sh" "$root" "${args[@]}" \
          >"$WORK/$cell.out" 2>"$WORK/$cell.err" )
      rc=$?

      moved=0; stayed=0
      for id in "${IDS[@]}"; do
        if compgen -G "$root/backlog/done/*/$id-fixture.yaml" > /dev/null; then moved=$((moved+1)); else stayed=$((stayed+1)); fi
      done

      # P2: all or nothing, in every cell.
      if (( moved != 0 && stayed != 0 )); then
        fail "P2 [$cell]: a PARTIAL close - $moved moved, $stayed stayed"
      fi
      if (( moved > 0 )); then reached_move=$((reached_move+1)); else reached_refuse=$((reached_refuse+1)); fi
      [[ "$bad" == "1" ]] && reached_partial=$((reached_partial+1))

      # P1: a refusal is obeyed and reported, and leaves no staged remnant.
      if [[ "$refuse" == "refuse" || "$bad" == "1" ]]; then
        if (( moved != 0 )); then fail "P1 [$cell]: a refused close moved $moved ticket(s)"; fi
        if (( rc == 0 )); then fail "P1 [$cell]: a refused close reported success"; fi
        if [[ -z "$(g "$root" status --porcelain | grep -v '^?? ')" ]]; then :; else
          fail "P1 [$cell]: the refusal left the index dirty: $(g "$root" status --porcelain | head -3)"
        fi
        if [[ ! -s "$WORK/$cell.err" ]]; then fail "P1 [$cell]: a refusal reported no reason"; fi
      fi

      # P3: closing never promotes, whatever happened above.
      if [[ ! -f "$root/backlog/paused/BL-9399-paused.yaml" ]] \
         || compgen -G "$root/backlog/active/BL-9399-*.yaml" > /dev/null; then
        fail "P3 [$cell]: a close promoted the paused ticket"
      fi
    done
  done
done

(( reached_move > 0 )) || fail "never exercised a successful close"
(( reached_refuse > 0 )) || fail "never exercised a refused close"
(( reached_partial > 0 )) || fail "never exercised a batch containing an unclosable id"

if [[ $status -eq 0 ]]; then
  echo "bl1363_close_ticket_property: ALL PROPERTIES HOLD over $cells constructed cells"
else
  echo "bl1363_close_ticket_property: FAILURES"
fi
exit $status
