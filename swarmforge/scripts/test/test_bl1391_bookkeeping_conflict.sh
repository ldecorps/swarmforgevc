#!/usr/bin/env bash
# BL-1391 e2e: a conflict confined to append-only bookkeeping files is resolved
# by the daemon instead of refusing - driven through a REAL `bb handoffd.bb
# --reconcile-sweep-once` tick against a REAL git repository and a REAL local
# remote. The lib alone can classify a conflict; only the daemon performs the
# absorb, which is what this ticket's required_wiring anchor is about.
#
# BL-1242: a chain of independent guards must NOT run under `set -e`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ../../.. - swarmforge/scripts/test -> the repository root. One level
# short made every `cp` from it fail silently, so the fixture had no scripts
# directory and scenario 3 had no code file to conflict on.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
FIXTURE_PREFIX="bl1391-bookkeeping-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

rm -rf "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}"* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT

# Every git call is guarded: `git -C ""` does NOT fail, it uses the current
# directory, so an empty fixture path would run against this repository.
in_fixture() { [[ -n "${1:-}" && "${1:-}" == "$WORK"/* && -d "${1:-}" ]]; }
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

TICKET="backlog/active/BL-9002-fixture.yaml"
EVIDENCE="backlog/evidence/BL-9002-coder-20260904.md"

# A master checkout diverged from its origin: base, then ours locally and
# theirs on origin, each only APPENDING to the same bookkeeping files.
setup() {
  name="$1"; root="$WORK/$name"; origin="$WORK/$name-origin.git"; other="$WORK/$name-other"
  mkdir -p "$root"
  git init -q --bare "$origin"
  git init -q -b main "$root"
  for k in user.email:t@t user.name:t commit.gpgsign:false; do
    g "$root" config "${k%%:*}" "${k##*:}" >/dev/null
  done
  mkdir -p "$root/backlog/active" "$root/backlog/evidence" "$root/backlog/paused" "$root/backlog/done" \
    "$root/swarmforge/scripts" "$root/.swarmforge/daemon" "$root/docs/briefings" \
    "$root/.swarmforge/handoffs/inbox/new" \
    "$root/.swarmforge/handoffs/coordinator/inbox/new" \
    "$root/.swarmforge/handoffs/coordinator/inbox/in_process" \
    "$root/.swarmforge/handoffs/coordinator/inbox/completed"
  # What the daemon reads before it reaches any sweep, mirroring
  # test_handoffd_master_main_reconcile_wiring.sh's own fixture: a socket
  # path, one role, a fake tmux on PATH, and today's briefing already present
  # so the unrelated briefing sweep is not due.
  echo "$root/fake-tmux-socket" > "$root/.swarmforge/tmux-socket"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  printf 'Headline: unrelated\n' > "$root/docs/briefings/$(date -u +%Y-%m-%d).md"
  mkdir -p "$root/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$root/bin/tmux"
  chmod +x "$root/bin/tmux"
  cp -R "$REPO_ROOT/swarmforge/scripts/." "$root/swarmforge/scripts/" || fail "setup($name): could not copy scripts from $REPO_ROOT"
  printf 'config master_main_reconcile_enabled true\nconfig active_backlog_max_depth 50\n' > "$root/swarmforge/swarmforge.conf"
  printf 'id: BL-9002\ntitle: a fixture ticket\nstatus: todo\n' > "$root/$TICKET"
  printf '# BL-9002 evidence\n\nbase paragraph\n' > "$root/$EVIDENCE"
  gq "$root" add -A && gq "$root" commit -m "seed" || fail "setup($name): seed failed"
  g "$root" remote add origin "$origin" >/dev/null
  gq "$root" push -u origin main || fail "setup($name): seed push failed"
  git clone -q -b main "$origin" "$other"
  for k in user.email:t@t user.name:t commit.gpgsign:false; do
    g "$other" config "${k%%:*}" "${k##*:}" >/dev/null
  done
}

# theirs: a record only QA writes at land.
theirs_appends_abandoned() {
  printf 'abandoned_commits: [abc1234567]\n' >> "$other/$TICKET"
  gq "$other" commit -aqm "QA: record abandoned_commits" || fail "theirs commit failed"
  gq "$other" push origin main || fail "theirs push failed"
}

# ours: the specifier's notes append on the same ticket, locally.
ours_appends_notes() {
  printf 'notes: |\n  the specifier appended this\n' >> "$root/$TICKET"
  gq "$root" commit -aqm "specifier: append notes" || fail "ours commit failed"
}

run_tick() {
  # BL-406: the daemon refuses a throwaway temp root unless told this is a
  # deliberate fixture, which it is.
  ( cd "$root" && env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
      SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$root/bin:$PATH" \
      timeout 240 bb "$HANDOFFD" "$root" --reconcile-sweep-once >"$root/tick.out" 2>&1 )
}

log_of() { cat "$root"/.swarmforge/daemon/*.log "$root/tick.out" 2>/dev/null || true; }
merge_head_present() { [[ -f "$root/.git/MERGE_HEAD" ]]; }

# ── 1. two appends to one ticket: resolved, lossless, visible ──────────────
setup one
theirs_appends_abandoned
ours_appends_notes
run_tick
if merge_head_present; then fail "scenario 1: a MERGE_HEAD was left behind"; else pass "the absorb completes with no MERGE_HEAD left"; fi
body="$(cat "$root/$TICKET" 2>/dev/null)"
if grep -q "the specifier appended this" <<<"$body" && grep -q "abandoned_commits: \[abc1234567\]" <<<"$body"; then
  pass "the ticket carries BOTH additions"
else
  fail "an addition was lost: $body"
fi
if g "$root" log -1 --format=%B 2>/dev/null | grep -q "$TICKET"; then
  pass "the merge commit body names the resolved path and the strategy"
else
  fail "the merge body does not name the path: $(g "$root" log -1 --format=%B 2>/dev/null)"
fi
if log_of | grep -q "bookkeeping-conflict"; then
  pass "the daemon log carries bookkeeping-conflict naming the path"
else
  fail "no bookkeeping-conflict log line: $(log_of | tail -25)"
fi

# ── 2. a scalar rewritten on both sides: refused exactly as today ──────────
setup two
sed -i 's/^title: .*/title: theirs renamed it/' "$other/$TICKET"
gq "$other" commit -aqm "QA: retitle"; gq "$other" push origin main
sed -i 's/^title: .*/title: ours renamed it/' "$root/$TICKET"
gq "$root" commit -aqm "specifier: retitle"
before_head="$(g "$root" rev-parse HEAD 2>/dev/null)"
run_tick
if [[ "$before_head" == "$(g "$root" rev-parse HEAD 2>/dev/null)" ]]; then
  pass "a rewritten scalar is refused - no merge commit"
else
  fail "the resolver committed a merge for a rewritten scalar"
fi
if merge_head_present; then fail "scenario 2: a MERGE_HEAD was left behind"; else pass "and nothing was left half-resolved"; fi

# ── 3. one code path in the conflict resolves nothing at all ───────────────
setup three
theirs_appends_abandoned
# A GENUINE code conflict: the same line rewritten on both sides. Appending to
# opposite ends of a large file is not one - git merges that cleanly, and a
# fixture built that way proves nothing (it read as "the resolver resolved a
# code conflict" when the code path was never conflicted at all).
sed -i '1s|.*|;; theirs rewrote this first line|' "$other/swarmforge/scripts/push_sweep_lib.bb"
gq "$other" commit -aqm "QA: rewrite a daemon script's first line"; gq "$other" push origin main
ours_appends_notes
sed -i '1s|.*|;; ours rewrote this first line|' "$root/swarmforge/scripts/push_sweep_lib.bb"
gq "$root" commit -aqm "specifier: rewrite the same first line"
run_tick
# Invariant 1's "resolves nothing at all" is about THIS resolver: it must
# refuse the whole conflict rather than resolve the bookkeeping half. What the
# pre-existing rematch ladder then does with the tree is today's behaviour and
# out of this ticket's scope, so the claim is read from the resolver's own log
# rather than from the file, which that ladder may legitimately rewrite.
if log_of | grep -q "bookkeeping-conflict refused"; then
  pass "a conflict including a code path is refused by the resolver"
else
  fail "the resolver did not refuse a conflict containing a code path: $(log_of | grep bookkeeping-conflict | tail -3)"
fi
if log_of | grep -q "bookkeeping-conflict resolved"; then
  fail "the resolver resolved a conflict that included a code path"
else
  pass "and nothing was resolved (invariant 1: all or nothing)"
fi
if merge_head_present; then fail "scenario 3: a MERGE_HEAD was left behind"; else pass "and no merge was left open"; fi

# ── 4. evidence appended by both sides; and a deletion refused ─────────────
setup four
printf '\ntheirs paragraph\n' >> "$other/$EVIDENCE"
gq "$other" commit -aqm "QA: append evidence"; gq "$other" push origin main
printf '\nours paragraph\n' >> "$root/$EVIDENCE"
gq "$root" commit -aqm "cleaner: append evidence"
run_tick
ev="$(cat "$root/$EVIDENCE" 2>/dev/null)"
if grep -q "ours paragraph" <<<"$ev" && grep -q "theirs paragraph" <<<"$ev"; then
  pass "an evidence file appended on both sides keeps both paragraphs"
else
  fail "an evidence paragraph was lost: $ev"
fi

setup five
sed -i '/base paragraph/d' "$other/$EVIDENCE"
gq "$other" commit -aqm "QA: delete a paragraph"; gq "$other" push origin main
printf '\nours paragraph\n' >> "$root/$EVIDENCE"
gq "$root" commit -aqm "cleaner: append evidence"
before_head="$(g "$root" rev-parse HEAD 2>/dev/null)"
run_tick
if [[ "$before_head" == "$(g "$root" rev-parse HEAD 2>/dev/null)" ]]; then
  pass "an evidence file with a deleted paragraph is refused"
else
  fail "a deletion was resolved"
fi

# ── 5. the resolver's merge runs the same guards; a refusal leaves nothing ──
setup six
# Arm a refusing guard chain the way git itself would run it. Both hook names
# are armed: `git commit` after a conflicted merge runs pre-commit, while an
# automatic merge commit runs pre-merge-commit - the resolver must be refused
# whichever path git takes, and must never bypass either (invariant 3).
theirs_appends_abandoned
ours_appends_notes
# Armed only NOW: a guard chain armed before the fixture's own commits would
# refuse those too, and the scenario would prove nothing about the resolver.
mkdir -p "$root/fixture-hooks"
for hook in pre-commit pre-merge-commit; do
  printf '#!/usr/bin/env bash\necho "fixture guard refuses" >&2\nexit 1\n' > "$root/fixture-hooks/$hook"
  chmod +x "$root/fixture-hooks/$hook"
done
g "$root" config core.hooksPath "$root/fixture-hooks" >/dev/null
before_head="$(g "$root" rev-parse HEAD 2>/dev/null)"
run_tick
if [[ "$before_head" == "$(g "$root" rev-parse HEAD 2>/dev/null)" ]]; then
  pass "a resolved absorb refused by the guard chain makes no merge commit"
else
  fail "the resolver committed past a refusing guard chain"
fi
if merge_head_present; then
  fail "scenario 5: a MERGE_HEAD was left behind after the guards refused"
else
  pass "and the refusing guard leaves no merge open"
fi
if log_of | grep -q "bookkeeping-conflict refused-by-guards"; then
  pass "the guard refusal is logged as such, not as a resolution"
else
  fail "no refused-by-guards log line: $(log_of | grep bookkeeping-conflict | tail -3)"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
