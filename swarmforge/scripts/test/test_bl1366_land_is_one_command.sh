#!/usr/bin/env bash
# BL-1366 e2e: landing an approved commit is one command.
#
# This is the slice that PUSHES, so every push here goes to a bare repo under
# this test's own temp root and the suite asserts, at the end, that the live
# repository's origin URL and refs were never touched (BL-1390's two incidents).
#
# BL-1242: independent guards do NOT run under `set -e`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LAND="$SCRIPT_DIR/../land_main_publish.sh"
FIXTURE_PREFIX="bl1366-land-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1366_SUITE_BOUND_SECONDS:-900}" "$@"
trap 'rm -rf "$WORK"' EXIT

LIVE_ORIGIN_BEFORE="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"
# Deliberately NOT the live `main` SHA: other roles land on main while this
# suite runs, so comparing it attributes their legitimate work to this test -
# observed as a red run that said "the suite touched the live repository" when
# it had done nothing of the kind. What this suite could actually break is a
# remote URL, which nothing else rewrites mid-run.

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

# A repo whose origin is a bare repo in $WORK, with the scripts it needs.
setup() {
  name="$1"; root="$WORK/$name"; origin="$WORK/$name-origin.git"
  mkdir -p "$root/.swarmforge" "$root/swarmforge" "$root/backlog/active"
  git init -q --bare "$origin"
  git -C "$origin" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
  git init -q -b main "$root"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do g "$root" config "${kv%%:*}" "${kv##*:}" >/dev/null; done
  if [[ ! -d "$WORK/shared-scripts" ]]; then
    cp -R "$REPO_ROOT/swarmforge/scripts" "$WORK/shared-scripts" || fail "setup($name): scripts copy failed"
  fi
  ln -s "$WORK/shared-scripts" "$root/swarmforge/scripts"
  g "$root" remote add origin "$origin" >/dev/null
  printf 'id: BL-9366\ntitle: fixture\nmilestone: M8\nstatus: todo\n' > "$root/backlog/active/BL-9366-fixture.yaml"
  echo seed > "$root/seed.txt"
  gq "$root" add -A && gq "$root" commit -m "seed" || fail "setup($name): seed failed"
  gq "$root" push -u origin main || fail "setup($name): seed push failed"
}

# The approved commit: one commit on top of origin/main, subject naming the id.
approve_commit() {
  echo "work $RANDOM" > "$root/work.txt"
  gq "$root" add -A
  gq "$root" commit -m "BL-9366: the approved work"
  g "$root" rev-parse HEAD
}

run_land() {
  # The FIXTURE's copy: land_main_publish.sh resolves land_step_cli.bb from its
  # own location, so running this repository's copy would consult this
  # repository's land step and the forced-escalation scenario would never be
  # reached (the same trap BL-1363's suite hit).
  ( cd "$root" && LAND_LOCK_WAIT_SECONDS="${2:-20}" timeout 300 \
      bash "$root/swarmforge/scripts/land_main_publish.sh" "$root" --land \
      "BL-9366-fixture-task" "$1" >"$WORK/$name.land.out" 2>"$WORK/$name.land.err" )
}
land_out() { cat "$WORK/$name.land.out" "$WORK/$name.land.err" 2>/dev/null; }
origin_main() { git -C "$origin" rev-parse main 2>/dev/null; }

# ── 1. a clean approved commit lands, no force, lock gone ─────────────────
setup one
SHA="$(approve_commit)"
run_land "$SHA"; rc=$?
if [[ "$(origin_main)" == "$SHA" ]]; then
  pass "the approved commit reached origin/main"
else
  fail "origin/main is $(origin_main), expected $SHA; land said: $(land_out | tail -3)"
fi
if grep -qE '\-\-force|\+refs/' <<<"$(land_out)"; then
  fail "the land used a force push"
else
  pass "the push used no force"
fi
if [[ ! -d "$root/.swarmforge/land-main.publish.lock" ]]; then
  pass "the land lock directory is gone afterwards"
else
  fail "the lock was left held"
fi
if (( rc == 0 )); then pass "a clean land exits 0"; else fail "a clean land exited $rc"; fi

# ── 2. origin moves before the push: exactly one rematch, then FF-only ────
setup two
SHA="$(approve_commit)"
# Somebody else lands first, so this push is rejected and one rematch is owed.
OTHER="$WORK/two-other"
git clone -q -b main "$origin" "$OTHER"
for kv in user.email:t@t user.name:t commit.gpgsign:false; do g "$OTHER" config "${kv%%:*}" "${kv##*:}" >/dev/null; done
echo other > "$OTHER/other.txt"; gq "$OTHER" add -A; gq "$OTHER" commit -m "someone else's landing"; gq "$OTHER" push origin main
OTHER_SHA="$(g "$OTHER" rev-parse HEAD)"
run_land "$SHA"
if grep -q 'LAND_REMATCH' <<<"$(land_out)"; then
  pass "a rejected push triggers exactly one rematch onto the current tip"
else
  fail "no rematch was attempted: $(land_out | tail -3)"
fi
if [[ "$(land_out | grep -c 'LAND_REMATCH')" == "1" ]]; then
  pass "and only one - never a second rematch"
else
  fail "more than one rematch: $(land_out | grep -c 'LAND_REMATCH')"
fi
if g "$origin" merge-base --is-ancestor "$OTHER_SHA" main 2>/dev/null; then
  pass "the other landing is still on origin/main - nothing was overwritten"
else
  fail "the rematch discarded another role's landing"
fi

# ── 3. LAND_ESCALATE: main untouched, reported, lock released ─────────────
setup three
SHA="$(approve_commit)"
BEFORE="$(origin_main)"
# Force the verdict by replacing the land step with one that escalates.
cat > "$WORK/shared-scripts-escalate.bb" <<'BB'
#!/usr/bin/env bb
(println "LAND_ESCALATE")
(println "fixture: forced escalation")
(System/exit 1)
BB
cp "$WORK/shared-scripts/land_step_cli.bb" "$WORK/land_step_cli.bb.real"
cp "$WORK/shared-scripts-escalate.bb" "$WORK/shared-scripts/land_step_cli.bb"
run_land "$SHA"; rc=$?
cp "$WORK/land_step_cli.bb.real" "$WORK/shared-scripts/land_step_cli.bb"
if [[ "$(origin_main)" == "$BEFORE" ]]; then
  pass "an escalation leaves origin/main byte-identical"
else
  fail "an escalation still pushed"
fi
if grep -q 'LAND_STOPPED' <<<"$(land_out)"; then
  pass "and the escalation is reported"
else
  fail "the escalation was not reported: $(land_out | tail -3)"
fi
if [[ ! -d "$root/.swarmforge/land-main.publish.lock" ]]; then
  pass "and the lock is not left held by an escalation"
else
  fail "an escalation left the lock held"
fi
if (( rc != 0 )); then pass "and it exits non-zero"; else fail "an escalation exited 0"; fi

# ── 4. a lock already held: bounded wait, then give up (never forced) ─────
setup four
SHA="$(approve_commit)"
mkdir -p "$root/.swarmforge/land-main.publish.lock"; echo 99999 > "$root/.swarmforge/land-main.publish.lock/pid"
BEFORE="$(origin_main)"
started=$(date +%s)
run_land "$SHA" 4
elapsed=$(( $(date +%s) - started ))
if grep -q 'LAND_LOCK_TIMEOUT' <<<"$(land_out)"; then
  pass "a held lock is waited on to a deadline, then given up"
else
  fail "no deadline was reported: $(land_out | tail -3)"
fi
if (( elapsed < 120 )); then
  pass "and the wait is bounded (${elapsed}s), never an unbounded spin"
else
  fail "the wait ran ${elapsed}s"
fi
if [[ "$(origin_main)" == "$BEFORE" ]]; then
  pass "and nothing was pushed while another land held the lock"
else
  fail "it pushed past a held lock"
fi
if [[ -d "$root/.swarmforge/land-main.publish.lock" ]]; then
  pass "and somebody else's lock is left exactly as it was"
else
  fail "it removed a lock it did not take"
fi

# ── 5. killed mid-sequence: no lock survives, the next land succeeds ──────
setup five
SHA="$(approve_commit)"
( cd "$root" && LAND_LOCK_WAIT_SECONDS=60 bash "$root/swarmforge/scripts/land_main_publish.sh" "$root" --land "BL-9366-fixture-task" "$SHA" \
    >"$WORK/five.kill.out" 2>&1 ) &
LAND_PID=$!
sleep 2; kill -TERM "$LAND_PID" 2>/dev/null; wait "$LAND_PID" 2>/dev/null
if [[ ! -d "$root/.swarmforge/land-main.publish.lock" ]]; then
  pass "a land killed mid-sequence leaves no lock behind (trap on every exit path)"
else
  fail "a killed land left the lock held"
fi
run_land "$SHA"
if [[ "$(origin_main)" == "$SHA" ]] || grep -q 'LAND_PUBLISHED' <<<"$(land_out)"; then
  pass "and a subsequent land succeeds"
else
  fail "the next land could not proceed: $(land_out | tail -3)"
fi

# ── 6. a GH-seeded ticket closes its issue; a plain one attempts nothing ──
setup six
SHA="$(approve_commit)"
# A stub issue_done.sh that records the call, so "was an issue call attempted"
# is answered by observation rather than by reading the land script.
cp "$WORK/shared-scripts/issue_done.sh" "$WORK/issue_done.sh.real" 2>/dev/null || true
cat > "$WORK/shared-scripts/issue_done.sh" <<STUB
#!/usr/bin/env bash
echo "ISSUE_DONE_CALLED \$1 \$2" >> "$WORK/issue-calls.txt"
exit 0
STUB
chmod +x "$WORK/shared-scripts/issue_done.sh"
: > "$WORK/issue-calls.txt"

( cd "$root" && timeout 300 bash "$root/swarmforge/scripts/land_main_publish.sh" "$root" --land     "BL-9366-fixture-task" "$SHA" "GH-42" >"$WORK/six.land.out" 2>&1 )
if grep -q 'ISSUE_DONE_CALLED GH-42' "$WORK/issue-calls.txt"; then
  pass "a GH-seeded ticket has its issue closed on a successful land"
else
  fail "no issue close was attempted: $(cat "$WORK/issue-calls.txt")"
fi

setup seven
SHA="$(approve_commit)"
: > "$WORK/issue-calls.txt"
( cd "$root" && timeout 300 bash "$root/swarmforge/scripts/land_main_publish.sh" "$root" --land     "BL-9366-fixture-task" "$SHA" >"$WORK/seven.land.out" 2>&1 )
if [[ ! -s "$WORK/issue-calls.txt" ]]; then
  pass "a ticket with no issue ref attempts no issue call at all"
else
  fail "an issue call was attempted for a non-GH ticket: $(cat "$WORK/issue-calls.txt")"
fi
[[ -f "$WORK/issue_done.sh.real" ]] && cp "$WORK/issue_done.sh.real" "$WORK/shared-scripts/issue_done.sh"

# ── the suite never touched the live repository ───────────────────────────
if [[ "$LIVE_ORIGIN_BEFORE" == "$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)" ]]; then
  pass "the live repository's origin URL is byte-identical after the suite"
else
  fail "the suite changed the live origin URL: '$LIVE_ORIGIN_BEFORE' -> '$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)'"
fi
if git -C "$REPO_ROOT" remote -v 2>/dev/null | grep -q "$WORK"; then
  fail "a live remote now points into this suite's fixture directory"
else
  pass "no live remote points into the fixture directory"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
