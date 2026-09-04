#!/usr/bin/env bash
# BL-1376: the expedite closing handover names the branch it left unlanded.
#
# BL-1375's run walked all seven hats, recorded pass for each, moved its ticket
# into backlog/done/ and printed its OUTSTANDING block. Every word was true.
# What it did not say is that expedite/BL-1375 was three commits ahead of
# origin/main and on no other branch, so a fix for a live deadlock reached
# nobody. The expeditor deliberately does not land (Article 1.8/4.2 put
# integration with QA), so the remedy is that the branch becomes the third
# NAMED leaving - and naming a leaving is not performing it.
#
# Drives the REAL expedite_cli.bb over the REAL shared fixture. No timers, no
# network: origin/main is a local ref, and the stage runner is the fixture's
# own seam.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../expedite_cli.bb"
FIXTURE="$SCRIPT_DIR/expedite_fixture.sh"

# BL-971: a killed run traps nothing, so sweep this prefix BEFORE the run too.
PREFIX="bl1376-expedite-handover"
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }
absent()   { if grep -qF -- "$3" <<<"$2"; then fail "$1 (unexpectedly found '$3')"; else pass "$1"; fi; }
check()    { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

mkfix() {
  local name="$1"; shift
  bash "$FIXTURE" "$TMPROOT/$name" "$@" >/dev/null
  echo "$TMPROOT/$name"
}

# origin/main as a LOCAL ref: the distance question is about a ref, not a
# network, and a fixture that reached out would be a flake waiting to happen.
set_origin_main() {
  git -C "$1" update-ref refs/remotes/origin/main "$(git -C "$1" rev-parse main)"
}

# A stage runner that leaves real work on the run branch, which the fixture's
# default (verdict only, no commits) deliberately does not.
install_committing_runner() {
  local root="$1" commits="$2"
  cat > "$root/stage-runner-commits.sh" <<SH
#!/usr/bin/env bash
set -euo pipefail
ROLE="\$1"; TICKET="\$2"; PROMPT="\$3"; VERDICT="\$4"; TRANSCRIPT="\$5"
ROOT="\$(cd "\$(dirname "\$0")" && pwd)"
echo "\$ROLE" >> "\$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage \$ROLE for \$TICKET" > "\$TRANSCRIPT"
WT="\$ROOT/.worktrees/expedite-\$TICKET"
if [[ "\$ROLE" == "coder" && -d "\$WT" ]]; then
  for i in \$(seq 1 $commits); do
    echo "work \$i" > "\$WT/work-\$i.txt"
    git -C "\$WT" add -A
    git -C "\$WT" -c user.email=fix@fix -c user.name=fix commit -qm "\$TICKET: fixture work \$i"
  done
fi
echo '{"verdict":"pass"}' > "\$VERDICT"
SH
  chmod +x "$root/stage-runner-commits.sh"
}

# Every seam is passed explicitly and nothing leaks between cases: an
# assignment-prefix on a `VAR=$(...)` line sets the variable for the whole
# shell, not for the command inside the substitution, which is exactly how a
# later case ends up running an earlier case's stage runner.
run() {
  local root="$1" runner="$2" probe="$3"; shift 3
  (
    export EXPEDITE_STAGE_RUNNER="$runner"
    export EXPEDITE_STOP_CMD="./stop-swarm.sh"
    export EXPEDITE_START_CMD="./start-swarm.sh"
    [[ -n "$probe" ]] && export EXPEDITE_PROBE_FILE="$probe"
    bb "$CLI" "$root" "$@" 2>&1
  )
}

# ═══════════════════════════════════════════════════════════════════════════
# 01 / 02-named / 06: a run that left commits names the branch, its distance
#                     and its owner - and lands nothing
# ═══════════════════════════════════════════════════════════════════════════
echo "01/02/06: a branch ahead of origin/main is named"
R="$(mkfix ahead --active BL-567 --active BL-590)"
set_origin_main "$R"
install_committing_runner "$R" 3
ORIGIN_BEFORE="$(git -C "$R" rev-parse refs/remotes/origin/main)"
MAIN_BEFORE="$(git -C "$R" rev-parse main)"

OUT="$(run "$R" "$R/stage-runner-commits.sh" "" BL-567 --no-restart)"

contains "01: the handover names the run branch" "$OUT" "expedite/BL-567"
contains "01: it states the distance from origin/main" "$OUT" "3 commits ahead of origin/main"
contains "01: the run branch is an OUTSTANDING subject" "$OUT" "the run branch"
contains "01: it names the owner who must land it" "$OUT" "owner: QA"
contains "01: and says under which rule" "$OUT" "BL-247"
# The run record carries the same item: terminal text scrolls away.
contains "01: the run record carries the branch item too" \
  "$(cat "$R/.swarmforge/expedite/BL-567/run.json")" "the run branch"

# Naming is not landing (invariant 2).
check "06: origin/main did not move" "$(git -C "$R" rev-parse refs/remotes/origin/main)" "$ORIGIN_BEFORE"
check "06: main did not move" "$(git -C "$R" rev-parse main)" "$MAIN_BEFORE"
check "06: the run branch is the only branch containing the run commits" \
  "$(git -C "$R" branch --contains "$(git -C "$R" rev-parse expedite/BL-567)" --format='%(refname:short)' | tr -d ' \n')" \
  "expedite/BL-567"
absent "06: the handover never claims the branch was landed" "$OUT" "landed"
absent "06: nor merged" "$OUT" "merged"

# ═══════════════════════════════════════════════════════════════════════════
# 02-not-named: a branch level with origin/main is genuinely nothing
# ═══════════════════════════════════════════════════════════════════════════
echo "02: a branch level with origin/main is not named"
R2="$(mkfix level --active BL-567 --active BL-590)"
set_origin_main "$R2"
OUT2="$(run "$R2" "$R2/stage-runner.sh" "" BL-567 --no-restart)"

check "02: the branch exists (so silence is the rule, not a missing branch)" \
  "$(git -C "$R2" rev-parse --verify --quiet expedite/BL-567 >/dev/null && echo yes || echo no)" "yes"
check "02: it is level with origin/main" \
  "$(git -C "$R2" rev-list --count refs/remotes/origin/main..expedite/BL-567)" "0"
absent "02: so the handover does not name it" "$OUT2" "the run branch"
contains "02: while the leavings it DID make are still reported" "$OUT2" "the parked tickets"

# ═══════════════════════════════════════════════════════════════════════════
# 03: a dry run still reports nothing outstanding
# ═══════════════════════════════════════════════════════════════════════════
echo "03: dry run"
R3="$(mkfix dry --active BL-567 --active BL-590)"
set_origin_main "$R3"
OUT3="$(run "$R3" "$R3/stage-runner.sh" "" BL-567 --no-restart --dry-run)"
contains "03: a dry run reports nothing outstanding" "$OUT3" "nothing outstanding"
absent "03: and names no branch" "$OUT3" "the run branch"

# ═══════════════════════════════════════════════════════════════════════════
# 04: an ancestry check that cannot run REPORTS rather than omits
# ═══════════════════════════════════════════════════════════════════════════
echo "04: unreadable ancestry"
R4="$(mkfix noorigin --active BL-567 --active BL-590)"
# deliberately no origin/main ref
install_committing_runner "$R4" 2
OUT4="$(run "$R4" "$R4/stage-runner-commits.sh" "" BL-567 --no-restart)"

contains "04: the branch is named even though the distance is unknown" "$OUT4" "expedite/BL-567"
contains "04: it is reported as an outstanding subject" "$OUT4" "the run branch"
contains "04: and the reason the distance could not be read is given" "$OUT4" "distance unknown"
absent "04: no distance is invented" "$OUT4" "commits ahead of origin/main"

# ═══════════════════════════════════════════════════════════════════════════
# 05: a refusal after parking reports the same three leavings as the run tail
# ═══════════════════════════════════════════════════════════════════════════
echo "05: refusal after parking"
R5="$(mkfix refusal --active BL-567 --active BL-590)"
set_origin_main "$R5"
# A branch left by an earlier run of the same ticket - the shape a re-expedite
# starts from, and the only way a refusal this early can have a branch at all.
git -C "$R5" worktree add -q -b expedite/BL-567 "$R5/.worktrees/expedite-BL-567" main
echo "earlier work" > "$R5/.worktrees/expedite-BL-567/earlier.txt"
git -C "$R5/.worktrees/expedite-BL-567" add -A
git -C "$R5/.worktrees/expedite-BL-567" -c user.email=fix@fix -c user.name=fix commit -qm "BL-567: earlier run's work"

cat > "$TMPROOT/probe-live.json" <<'JSON'
{"tmux-servers-answering":1,"handoffd":true,"role-agents":8}
JSON
OUT5="$(run "$R5" "$R5/stage-runner.sh" "$TMPROOT/probe-live.json" BL-567 --no-restart)"; EXIT5=$?

check "05: the run refused" "$EXIT5" "1"
contains "05: the refusal is the teardown one, which fires after parking" "$OUT5" "REFUSE teardown did not reach a clean slate"
contains "05: it names the run branch" "$OUT5" "the run branch"
contains "05: it names the parked tickets" "$OUT5" "the parked tickets"
contains "05: it names the uncommitted backlog moves" "$OUT5" "the uncommitted backlog moves"
check "05: and the tickets really were parked" \
  "$(ls "$R5/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"

# ═══════════════════════════════════════════════════════════════════════════
# 06b: invariant 2, read from the SOURCE rather than the behaviour
# ═══════════════════════════════════════════════════════════════════════════
echo "06b: the driver still performs no land"
BRANCH_READS="$(sed -n '/defn- run-branch-facts/,/^(defn- outstanding-now/p' "$SCRIPT_DIR/../expedite_cli.bb")"
absent "06b: the branch read never merges" "$BRANCH_READS" '"merge"'
absent "06b: never pushes" "$BRANCH_READS" '"push"'
absent "06b: and never checks anything out" "$BRANCH_READS" '"checkout"'
contains "06b: it only counts" "$BRANCH_READS" '"rev-list" "--count"'

if [[ $fails -gt 0 ]]; then
  echo "test_bl1376_expedite_branch_handover: $fails FAILURE(S)"
  exit 1
fi
echo "test_bl1376_expedite_branch_handover: ALL PASS"
