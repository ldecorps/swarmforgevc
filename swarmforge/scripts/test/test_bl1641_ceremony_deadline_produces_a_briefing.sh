#!/usr/bin/env bash
# BL-1641: a closing ceremony at its briefing deadline produces a briefing
# before the stop. Drives the REAL compiled ceremony CLI (buildRealDeps,
# never a mock) against a scratch LOCAL CLONE of this repo, so the real
# commit_integrity_cli.bb / compose_banked_briefing_cli.bb chain is
# reachable at its real relative path - never the live checkout itself
# (BL-1390: every mutating git command below runs inside a clone this
# script itself created under mkdtemp, proven by rev-parse
# --git-common-dir before the first commit).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$REPO_ROOT/extension/out/tools/night-closing-ceremony-run.js"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1641-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1641_SUITE_BOUND_SECONDS:-300}" "$@"
trap 'rm -rf "$WORK"' EXIT

if [[ ! -f "$CLI" ]]; then
  fail "the ceremony CLI is not compiled - run npm run compile from extension/"
  echo "FAILURES"; exit 1
fi

# A synthetic future date, never today's real date - this fixture clones
# the actual repo, whose real main branch may (and during this very
# session, does) already carry a real docs/briefings/<today>.md; colliding
# with it would make "main already has a briefing" true by accident,
# defeating scenarios 1/2 rather than testing them.
TODAY="2099-01-01"
DOC_BRANCH="sc-documenter"

# A scratch LOCAL CLONE of this repo (fast: hardlinked, ~1s) - never the
# live checkout - so the real bb tool chain (commit_integrity_cli.bb and
# its own load-file chain, compose_banked_briefing_cli.bb) is reachable at
# its real relative path with no manual file copying to keep in sync.
make_clone() {  # make_clone <name>
  root="$WORK/$1"
  git clone -q --local "$REPO_ROOT" "$root" >/dev/null 2>&1
  # BL-1390: prove this clone owns its own git dir before any mutating
  # command - never the live repo's.
  local common_dir
  common_dir="$(git -C "$root" rev-parse --git-common-dir)"
  case "$common_dir" in
    /*) : ;;
    *) common_dir="$root/$common_dir" ;;
  esac
  if [[ "$(cd "$(dirname "$common_dir")" && pwd)" != "$root"* ]]; then
    echo "REFUSING: clone at $root does not own its own git dir ($common_dir)" >&2
    exit 1
  fi
  # This ticket's own tooling (compose_banked_briefing_cli.bb, and any
  # in-flight fix on this branch) lives on THIS worktree's own branch,
  # not yet landed to main by the normal pipeline (cleaner -> ... -> QA).
  # Point the clone's "main" at this branch's own tip - "main" stays the
  # ref the ceremony's own git checks (mainHasBriefing) name, but its
  # content is what main will actually carry once this parcel lands,
  # never a stale pre-parcel main that would make every land-or-compose
  # scenario fail on a missing tool it will genuinely have by then.
  git -C "$root" checkout -q -B main
  git -C "$root" config user.email t@t
  git -C "$root" config user.name t
  git -C "$root" config commit.gpgsign false
  mkdir -p "$root/.swarmforge/daemon" "$root/.swarmforge/lean/ceremony" \
           "$root/.swarmforge/handoffs/inbox/new" "$root/.swarmforge/handoffs/inbox/in_process" \
           "$root/docs/briefings"
  printf 'documenter\tdocumenter\t%s\t%s\tDocumenter\tclaude\ttask\ncoordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' \
    "$root" "$DOC_BRANCH" "$root" > "$root/.swarmforge/roles.tsv"
  printf 'config closure_stop_local 08:45\nconfig closing_drain_budget_minutes 1\nconfig closing_briefing_budget_minutes 1\n' \
    > "$root/swarmforge/swarmforge.conf"
  printf '2026-09-04T09:00:00Z\n' > "$root/.swarmforge/shift-started"
  # This fixture has no live daemon/tmux socket; swarm_handoff.sh's own
  # sync-tmux-inject step fails hard without one (a pre-existing gap: its
  # caller has no try/catch around that call). Removing it here forces
  # sendHandoffNote's own graceful fallback (a marker file), the same
  # no-daemon posture test_bl1393's bare fixture already relies on -
  # irrelevant to this ticket's own claims (ensure-briefing at the
  # deadline), never a workaround for anything BL-1641 itself does.
  rm -f "$root/swarmforge/scripts/swarm_handoff.sh"
}

tick_at() {  # tick_at <root> <now_ms>
  ( cd "$1" && node "$CLI" --target "$1" --conf "$1/swarmforge/swarmforge.conf" --now "$2" --sleep-path finish-shift 2>&1 )
}

state_field() {  # state_field <root> <field>
  node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = s[process.argv[2]];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch { process.stdout.write(""); }
  ' "$root/.swarmforge/daemon/closing-ceremony-state.json" "$2"
}

# The seam-driven clock: freeze at t0, drain-to-briefing past the 1-minute
# drain budget, past-deadline past the 1-minute briefing budget - three
# ticks, zero real sleeps. t0 is on the SAME synthetic day as TODAY above
# (never real "now" - the ceremony's own dayKey, which ensure-briefing acts
# on, is derived from --now, and must name the same day the fixture's
# documenter commit and main-briefing checks use).
t0="$(node -e 'process.stdout.write(String(Date.UTC(2099,0,1,16,0,0)))')"
t_drain="$((t0 + 60000 + 1000))"
t_deadline="$((t0 + 2*60000 + 1000))"

# ── 01: the documenter branch's briefing commit is landed on main ────────
make_clone sc01
git -C "$root" checkout -q -b "$DOC_BRANCH"
printf '# Briefing for %s\n\nBody text from the documenter.\n' "$TODAY" > "$root/docs/briefings/$TODAY.md"
git -C "$root" add "docs/briefings/$TODAY.md"
git -C "$root" commit -qm "documenter: briefing for $TODAY" >/dev/null
DOC_SHA="$(git -C "$root" rev-parse HEAD)"
git -C "$root" checkout -q main
main_before="$(git -C "$root" rev-parse main)"
tick_at "$root" "$t0" >/dev/null
tick_at "$root" "$t_drain" >/dev/null
out01="$(tick_at "$root" "$t_deadline")"
main_after="$(git -C "$root" rev-parse main)"
landed_content="$(git -C "$root" show "main:docs/briefings/$TODAY.md" 2>/dev/null)"
doc_content="$(git -C "$root" show "$DOC_SHA:docs/briefings/$TODAY.md" 2>/dev/null)"
touched="$(git -C "$root" diff --name-only "$main_before" "$main_after" 2>/dev/null)"
if [[ -n "$landed_content" && "$landed_content" == "$doc_content" && "$touched" == "docs/briefings/$TODAY.md" ]]; then
  pass "main's tip adds docs/briefings/<today>.md byte-identical to the documenter's copy and touches no other path"
else
  fail "expected main to gain exactly the documenter's byte-identical file, touched=[$touched] before=$main_before after=$main_after: $out01"
fi
seq01="$(state_field "$root" sequence)"
if grep -q 'briefing-landed-from-documenter' <<<"$seq01"; then
  pass "the recorded sequence contains briefing-landed-from-documenter before swarm-stopped"
else
  fail "expected briefing-landed-from-documenter in the sequence: $seq01 ($out01)"
fi
if grep -q 'closing-briefing-missing' "$root/.swarmforge/daemon/closing-ceremony-loud.log" 2>/dev/null; then
  pass "closing-briefing-missing is surfaced"
else
  fail "expected closing-briefing-missing in the loud log"
fi

# ── 02: with no briefing anywhere the banked briefing is composed ────────
make_clone sc02
# No documenter commit at all: the branch exists but never touched the path.
git -C "$root" branch -q "$DOC_BRANCH"
tick_at "$root" "$t0" >/dev/null
tick_at "$root" "$t_drain" >/dev/null
out02="$(tick_at "$root" "$t_deadline")"
composed_content="$(git -C "$root" show "main:docs/briefings/$TODAY.md" 2>/dev/null)"
first_line02="$(head -1 <<<"$composed_content")"
if [[ "$first_line02" == "Closing ceremony - headless briefing for $TODAY" ]]; then
  pass "main's tip adds docs/briefings/<today>.md whose first line names the closing ceremony"
else
  fail "expected the headless composer's first line, got: $first_line02 ($out02)"
fi
seq02="$(state_field "$root" sequence)"
if grep -q 'briefing-composed-headless' <<<"$seq02"; then
  pass "the recorded sequence contains briefing-composed-headless before swarm-stopped"
else
  fail "expected briefing-composed-headless in the sequence: $seq02 ($out02)"
fi

# ── 03: a briefing main already has but has not emailed is left alone ────
make_clone sc03
git -C "$root" branch -q "$DOC_BRANCH"
printf 'Already on main.\n' > "$root/docs/briefings/$TODAY.md"
git -C "$root" add "docs/briefings/$TODAY.md"
git -C "$root" commit -qm "main already has today's briefing" >/dev/null
main_before03="$(git -C "$root" rev-parse main)"
tick_at "$root" "$t0" >/dev/null
tick_at "$root" "$t_drain" >/dev/null
out03="$(tick_at "$root" "$t_deadline")"
main_after03="$(git -C "$root" rev-parse main)"
seq03="$(state_field "$root" sequence)"
if [[ "$main_before03" == "$main_after03" ]]; then
  pass "a briefing main already has is left alone: main's tip is unchanged"
else
  fail "expected main's tip unchanged, was $main_before03 now $main_after03: $out03"
fi
if [[ "$seq03" == *"briefing-missing,swarm-stopped"* ]] || { grep -q 'briefing-missing' <<<"$seq03" && grep -q 'swarm-stopped' <<<"$seq03" && ! grep -q 'briefing-landed-from-documenter\|briefing-composed-headless' <<<"$seq03"; }; then
  pass "the recorded sequence ends with briefing-missing, swarm-stopped"
else
  fail "expected an unforced briefing-missing,swarm-stopped ending: $seq03"
fi

# ── 04: nothing producible still ends the night loudly ───────────────────
make_clone sc04
git -C "$root" branch -q "$DOC_BRANCH"
# A composer that always fails: shadow the real CLI with one that exits 1.
cat > "$root/swarmforge/scripts/compose_banked_briefing_cli.bb" <<'EOF'
#!/usr/bin/env bb
(binding [*out* *err*] (println "compose-banked-briefing-cli: forced failure for test"))
(System/exit 1)
EOF
main_before04="$(git -C "$root" rev-parse main)"
tick_at "$root" "$t0" >/dev/null
tick_at "$root" "$t_drain" >/dev/null
out04="$(tick_at "$root" "$t_deadline")"
main_after04="$(git -C "$root" rev-parse main)"
seq04="$(state_field "$root" sequence)"
if [[ "$main_before04" == "$main_after04" ]]; then
  pass "with a failing composer main's tip is unchanged"
else
  fail "expected main's tip unchanged, was $main_before04 now $main_after04: $out04"
fi
if grep -q 'briefing-missing' <<<"$seq04" && grep -q 'swarm-stopped' <<<"$seq04" \
   && ! grep -q 'briefing-landed-from-documenter\|briefing-composed-headless' <<<"$seq04"; then
  pass "the recorded sequence ends with briefing-missing, swarm-stopped"
else
  fail "expected an unforced briefing-missing,swarm-stopped ending: $seq04"
fi
if grep -q 'closing-briefing-missing' "$root/.swarmforge/daemon/closing-ceremony-loud.log" 2>/dev/null; then
  pass "closing-briefing-missing is surfaced"
else
  fail "expected closing-briefing-missing in the loud log"
fi
# kill_pipeline_swarm.sh (shelled by nightStop's real dep via
# kill_all_swarm.sh) itself rm -f's .swarmforge/daemon/stop once it has
# consumed it as a trigger - a transient signal, not a persistent marker -
# so its own completion log is the durable evidence a stop actually ran.
if grep -q 'kill_all_swarm SUCCESS' "$root/.swarmforge/daemon/kill-all-audit.log" 2>/dev/null; then
  pass "the swarm is stopped"
else
  fail "expected kill_all_swarm's own completion log to record success"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
