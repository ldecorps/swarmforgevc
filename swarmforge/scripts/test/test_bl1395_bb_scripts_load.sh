#!/usr/bin/env bash
# BL-1395 e2e: a landed daemon script is booted before it is published.
#
# Three Babashka files that fail SCI analysis reached main in eight days,
# because nothing on the commit path or the land path ever LOADED one - the
# last of them crash-looped the live daemon from 18:20Z on 2026-09-04, and its
# land's whole verification was three greps for required_wiring labels.
#
# Every case here builds a real tree and runs the real guard against it.
#
# BL-1242: independent guards do NOT run under `set -e`.
# BL-1390: no blind prefix sweep - the shared isolation helper owns $WORK.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE_PREFIX="bl1395-bbload-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

# This suite builds throwaway repositories, and it runs inside the commit guard
# chain (the changed-path gate) - where git exports GIT_DIR and GIT_INDEX_FILE
# to its hooks. Under those, `git init <fixture>` initialises the CALLER's
# repository and the fixture's own `add -A` + `commit` land on the caller's
# branch: this suite committed "seed" onto a live branch exactly once, which is
# how the leak was found. A test never inherits a git environment.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_PREFIX GIT_REFLOG_ACTION

source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1395_SUITE_BOUND_SECONDS:-1200}" "$@"
trap 'rm -rf "$WORK"' EXIT

# A tree under test: this repository's scripts, in a fresh repo, so the guard's
# verdict is a function of THAT tree and not of the checker's worktree.
make_tree() {
  name="$1"; root="$WORK/$name"
  mkdir -p "$root/swarmforge/scripts"
  cp -R "$REPO_ROOT/swarmforge/scripts/." "$root/swarmforge/scripts/" || fail "setup($name): copy failed"
  git init -q -b main "$root"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do
    git -C "$root" config "${kv%%:*}" "${kv##*:}" >/dev/null
  done
  git -C "$root" add -A >/dev/null 2>&1
  git -C "$root" commit -qm seed >/dev/null 2>&1
}

commit_tree() { git -C "$root" add -A >/dev/null 2>&1; git -C "$root" commit -qm "$1" >/dev/null 2>&1; }
run_guard() { timeout 600 bash "$root/swarmforge/scripts/check_bb_scripts_load.sh" "$root" "$@" 2>&1; }

# ── 1. a forward reference is refused, naming file, line and symbol ───────
make_tree one
printf '(defn f [] (g))\n(defn g [] 1)\n' > "$root/swarmforge/scripts/bl1395_forward.bb"
commit_tree "a forward-referencing lib"
out="$(run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out"; then pass "a forward reference is refused"; else fail "not refused: $(tail -2 <<<"$out")"; fi
if grep -q 'bl1395_forward.bb' <<<"$out" && grep -q 'Unable to resolve symbol: g' <<<"$out" && grep -q ':line' <<<"$out"; then
  pass "and the refusal names the file, the line and the symbol"
else
  fail "the refusal is not specific enough: $(tail -2 <<<"$out")"
fi

printf '(defn g [] 1)\n(defn f [] (g))\n' > "$root/swarmforge/scripts/bl1395_forward.bb"
commit_tree "define g first"
if run_guard | grep -q 'all clean'; then pass "the same file passes once g is defined above f"; else fail "the reordered file still refuses"; fi

# ── 1c. a call to a function defined nowhere at all ──────────────────────
make_tree one_c
printf '(defn f [] (never-defined-anywhere 1))\n' > "$root/swarmforge/scripts/bl1395_missing.bb"
commit_tree "a lib calling a function that does not exist"
out="$(run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'never-defined-anywhere' <<<"$out"; then
  pass "a call to a function defined nowhere is refused, naming the symbol"
else
  fail "a missing function was not caught: $(tail -2 <<<"$out")"
fi

# ── 2. BL-1381's shape: a runtime require inside a fn body ────────────────
make_tree two
printf "(defn go []\n  (require '[babashka.process :as process])\n  (process/shell \"true\"))\n(go)\n" \
  > "$root/swarmforge/scripts/bl1395_runtime_require.bb"
commit_tree "a lib requiring at runtime and calling through the alias"
out="$(run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'bl1395_runtime_require.bb' <<<"$out"; then
  pass "a runtime require whose alias is used at analysis time is refused (BL-1381's shape)"
else
  fail "BL-1381's shape was not caught: $(tail -2 <<<"$out")"
fi

# ── 3. handoffd is BOOTED: today's defect, and the healthy tip ───────────
make_tree three
# Reintroduce exactly 2026-09-04's defect: a sweep calling an undefined symbol.
python3 - "$root/swarmforge/scripts/handoffd.bb" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("(defn- cron-heartbeat-state []", "(defn- cron-heartbeat-state []\n  (read-json \"/nonexistent\")", 1)
open(p,'w').write(s)
PY
commit_tree "reintroduce the read-json defect in the daemon"
out="$(run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'handoffd.bb' <<<"$out"; then
  pass "a daemon that cannot boot is refused, naming handoffd.bb"
else
  fail "the boot step passed a broken daemon: $(tail -3 <<<"$out")"
fi

# ── 3b. the boot marker must not be honoured inside an error report ──────
# Babashka echoes the offending source in its `Context` block, so a daemon
# whose last line prints the success marker prints that marker inside its own
# analysis error. A marker-only check reads that as a healthy boot. Found by
# the invariant-2 property test, kept here as a regression.
make_tree three_b
cat > "$root/swarmforge/scripts/handoffd.bb" <<'BB'
(when (empty? *command-line-args*) (System/exit 3))
(defn probe [] (undefined-on-purpose))
(println "sweep-once done")
BB
commit_tree "a daemon whose error report quotes the success marker"
out="$(run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'handoffd.bb' <<<"$out"; then
  pass "a boot marker quoted inside an error report is not honoured as a boot"
else
  fail "the marker inside the error banner passed a broken daemon: $(tail -3 <<<"$out")"
fi

make_tree four
# A realistic change set: one healthy .bb touched, which is what the guard sees
# on a real commit. (A seed commit containing EVERY script is not - and using
# one surfaced a separate, pre-existing finding, recorded in the evidence:
# some CLIs run work at load because their main call is unguarded.)
printf '(defn healthy [] :ok)\n' > "$root/swarmforge/scripts/bl1395_healthy.bb"
commit_tree "a healthy lib"
out="$(run_guard)"
if grep -q 'all clean' <<<"$out"; then
  pass "the healthy tip boots and passes"
else
  fail "the healthy tree was refused: $(tail -3 <<<"$out")"
fi

# ── 4. invariant 3: the verdict is the TREE's, not the checker's ─────────
make_tree five
# The symbol exists in THIS repository's scripts but not on the tree under
# test - a guard that consulted its own worktree would pass this.
printf '(load-file "helper.bb")\n(defn f [] (helper-fn))\n' > "$root/swarmforge/scripts/bl1395_tree_only.bb"
printf '(defn helper-fn [] 1)\n' > "$REPO_ROOT/.bl1395-checker-only.bb"
commit_tree "a lib whose helper is absent from this tree"
out="$(run_guard)"
rm -f "$REPO_ROOT/.bl1395-checker-only.bb"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'bl1395_tree_only.bb' <<<"$out"; then
  pass "a file that does not load on the TREE is refused, whatever the checker's worktree holds"
else
  fail "the tree-only failure was not caught: $(tail -2 <<<"$out")"
fi

# ── 4b. a leaked git environment neither steers nor damages the checker ──
# A pre-commit hook exports GIT_DIR and GIT_INDEX_FILE, and the guard is wired
# INTO that hook. Under those variables `git init <fixture>` initialises the
# hook's repository instead, so the boot fixture's own `add -A` + `commit`
# landed a commit named "seed" on the live branch the first time this guard ran
# in the chain. The same leak would make the changed-file listing read the
# checker's repo rather than the tree under test, inverting invariant 3.
decoy="$WORK/decoy"
mkdir -p "$decoy"
git init -q -b main "$decoy" >/dev/null 2>&1
git -C "$decoy" config user.email t@t; git -C "$decoy" config user.name t
git -C "$decoy" config commit.gpgsign false
echo decoy > "$decoy/file.txt"; git -C "$decoy" add -A; git -C "$decoy" commit -qm decoy >/dev/null 2>&1
decoy_head_before="$(git -C "$decoy" rev-parse HEAD)"

make_tree four_b
printf '(defn caller [] (never-defined-anywhere))\n' > "$root/swarmforge/scripts/bl1395_leak.bb"
commit_tree "a broken lib checked with a leaked git environment"
out="$(GIT_DIR="$decoy/.git" GIT_WORK_TREE="$decoy" GIT_INDEX_FILE="$decoy/.git/index" run_guard)"
if grep -q 'BB_LOAD_BLOCK' <<<"$out" && grep -q 'bl1395_leak.bb' <<<"$out"; then
  pass "a leaked GIT_DIR does not steer the verdict away from the tree under test"
else
  fail "the leaked git environment changed the verdict: $(tail -3 <<<"$out")"
fi
if [[ "$(git -C "$decoy" rev-parse HEAD)" == "$decoy_head_before" ]]; then
  pass "and the leaked repository gains no commit of the guard's fixture"
else
  fail "the guard committed its fixture into the leaked repository"
fi

# ── 5. the guard is wired into both publish paths ────────────────────────
if grep -q 'check_bb_scripts_load.sh' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"; then
  pass "the guard is in the commit guard chain (a hand-splice on main meets it)"
else
  fail "run_commit_guards.sh does not run the guard"
fi
if grep -q 'check_bb_scripts_load.sh' "$REPO_ROOT/swarmforge/scripts/land_step_lib.bb"; then
  pass "and in the land replay's tree-guard list (a replay meets it)"
else
  fail "land_step_lib.bb does not list the guard"
fi

# ── 5b. one refusing guard never silences the others ─────────────────────
# The chain runs each guard through run_guard, which captures its status and
# carries on (BL-1242/BL-1252); a bare invocation under the chain's own shell
# would let the first refusal end the run.
if grep -qE '^run_guard check_bb_scripts_load\.sh' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh"; then
  pass "the guard runs through run_guard, so every other guard's status is still reported"
else
  fail "the guard is invoked outside run_guard, which would mask the guards after it"
fi

# ── 6. regression on the real tree: load analyses, never boots ───────────
SECONDS=0
probe="$(timeout 120 bb -e "(load-file \"$REPO_ROOT/swarmforge/scripts/handoffd.bb\")" 2>&1; echo "rc=$?")"
probe_seconds=$SECONDS
# "No daemon process starts" is measured by what a started daemon would DO:
# handoffd loops forever, so the probe would never return and would leave a
# process behind. A pid COUNT is not the observable - the live daemon, the
# guard's own boot fixtures and other roles all match the same pattern, and
# counting them made this check report a start that never happened.
if (( probe_seconds < 90 )) && ! ps -eo args | grep -q '[l]oad-file.*handoffd\.bb'; then
  pass "no daemon process starts when handoffd.bb is loaded as a file"
else
  fail "the load probe left a daemon running (${probe_seconds}s)"
fi
if grep -q 'rc=0' <<<"$probe" && ! grep -q 'Usage: handoffd.bb' <<<"$probe"; then
  pass "load-file on the real handoffd.bb analyses without starting a daemon (guarded -main)"
else
  fail "the load probe still runs the daemon: $(head -2 <<<"$probe")"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
