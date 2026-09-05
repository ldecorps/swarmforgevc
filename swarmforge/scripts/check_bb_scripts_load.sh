#!/usr/bin/env bash
# BL-1395: no Babashka script that fails SCI analysis reaches main.
#
# Babashka's SCI analyses a `defn` EAGERLY, so a body referencing a symbol that
# is not yet defined - a missing function, a runtime `require`, a forward
# reference - fails at LOAD, before any function runs. Three such files reached
# main in eight days: BL-1381's shift_schedule_applier_lib.bb (unseen since
# 2026-08-27, every consumer crashing), and twice on BL-1392, the second time
# through a hand-splice at land whose whole verification was three greps for
# required_wiring labels. The live daemon crash-looped from 18:20Z.
#
# A grep for a label is not proof a file loads. Only loading it is.
#
# Usage: check_bb_scripts_load.sh [<tree-root>] [--assume-main] [--all]
#   <tree-root>  the tree UNDER TEST (default: the repo this script sits in).
#                Every verdict is a function of that tree alone - a script that
#                loads in the checker's worktree but not on the tree refuses
#                (invariant 3, BL-1385 invariant 2 carried forward).
#   --all        analyse every .bb under swarmforge/scripts rather than only
#                what the tree's own HEAD commit changed.
#
# BL-1242/BL-1252: no `set -e`. Each file's status is captured and the whole
# set is reported, so one broken script never masks the next.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE_ROOT=""
CHECK_ALL=0
for arg in "$@"; do
  case "$arg" in
    --assume-main) ;;                     # accepted for the tree-guard contract
    --all) CHECK_ALL=1 ;;
    --*) ;;
    *) [[ -z "$TREE_ROOT" ]] && TREE_ROOT="$arg" ;;
  esac
done
TREE_ROOT="${TREE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

if [[ ! -d "$TREE_ROOT" ]]; then
  echo "check_bb_scripts_load: tree root not found: $TREE_ROOT" >&2
  exit 1
fi

SCRIPTS_DIR="$TREE_ROOT/swarmforge/scripts"
if [[ ! -d "$SCRIPTS_DIR" ]]; then
  echo "check_bb_scripts_load: no swarmforge/scripts on this tree ($TREE_ROOT) - nothing to analyse."
  exit 0
fi

if ! command -v bb >/dev/null 2>&1; then
  # A guard that cannot RUN is a refusal, not a skip: silently passing would
  # re-open the window this exists to close.
  echo "BB_LOAD_BLOCK: babashka is not on PATH, so no script could be analysed." >&2
  exit 1
fi

# Every git call below runs with the caller's git environment SCRUBBED. This is
# not hygiene, it is correctness twice over. A pre-commit hook exports GIT_DIR
# and GIT_INDEX_FILE, and `git init <fixture>` under those variables initialises
# the HOOK's repository instead - so the boot fixture's own `add -A` + `commit`
# landed a commit named "seed" on the live branch the first time this guard ran
# inside the chain it is wired into. The same leak would also make
# `git -C "$TREE_ROOT" show HEAD` read the CHECKER's repo rather than the tree
# under test, quietly inverting invariant 3.
git_clean() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR \
      -u GIT_CEILING_DIRECTORIES -u GIT_PREFIX -u GIT_REFLOG_ACTION \
      git "$@"
}

# Which files: the tree's own HEAD commit by default, everything with --all.
changed_bb_files() {
  if (( CHECK_ALL )); then
    find "$SCRIPTS_DIR" -maxdepth 1 -name '*.bb' -print | sort
    return
  fi
  local listed
  listed="$(git_clean -C "$TREE_ROOT" show --name-only --format= HEAD 2>/dev/null \
            | grep -E '^swarmforge/scripts/[^/]+\.bb$' || true)"
  local rel
  while IFS= read -r rel; do
    [[ -n "$rel" && -f "$TREE_ROOT/$rel" ]] && printf '%s\n' "$TREE_ROOT/$rel"
  done <<< "$listed"
}

status=0
failures=""
analysed=0

# The probe. `*command-line-args*` is empty and the file is analysed from
# the TREE's own scripts directory, so a script that load-files siblings picks
# up that tree's siblings and not the checker's. BL-1427: the driver reads
# and evaluates every top-level form except a call to -main (bare, with
# *command-line-args*, or through apply), so the entry point is analysed
# but never RUN - a healthy CLI whose -main has a fixed, non-zero arity no
# longer throws an ArityException it would never hit under real args. The
# target path travels via an env var, never a positional arg, so it is
# invisible to the ANALYSED script's own *command-line-args*
# (BB_LOAD_ANALYSE_TARGET, not `bb driver.bb "$file"` - see the driver's
# own header for why that distinction matters). `</dev/null`: the probe
# reads no stdin, so a script whose analysis-time code slurps *in* cannot
# drain this loop the way harness_env_scrub_names.bb once did.
analyse_one() {
  local file="$1" out rc=0
  out="$(cd "$SCRIPTS_DIR" && BABASHKA_PRELOADS='' BB_LOAD_ANALYSE_TARGET="$file" \
         timeout "${BB_LOAD_TIMEOUT:-60}" \
         bb "$SCRIPT_DIR/bb_load_analyse_driver.bb" </dev/null 2>&1)" || rc=$?
  # A non-zero exit is NOT the question. Most scripts here are CLIs that print
  # usage and exit when run without arguments - they have LOADED perfectly, and
  # failing them would make this guard refuse a healthy tree (observed on the
  # first run: hardening_debt_ledger_read.bb). What refuses is an SCI ANALYSIS
  # error: the file could not even be read into functions.
  # The discriminator is babashka's own error banner, not the exit code. Most
  # scripts here are CLIs that print usage and exit when run without arguments
  # - they LOADED perfectly, and refusing them would make this guard reject a
  # healthy tree (observed: hardening_debt_ledger_read.bb). A file that could
  # not be loaded prints `----- Error ---` with a Type: and a Location:,
  # whether the cause is an eager-analysis symbol or a missing sibling.
  if grep -qE '^-+ Error|Unable to resolve symbol|Could not resolve symbol|Could not find namespace' <<<"$out"; then
    # Name the file, and the line and symbol SCI itself reported - a refusal
    # that says only "failed" sends the reader back to reproduce it.
    local detail
    detail="$(grep -E 'Unable to resolve|Could not resolve|Could not find namespace|^Type:|^Message:|^Location:|:line' <<<"$out" | head -3 | tr '\n' ' ')"
    failures+="  $(basename "$file"): ${detail:-exit $rc}"$'\n'
    status=1
  fi
}

# BL-1427: the full listed set is captured into an ARRAY, never streamed
# through a `while read < <(process substitution)` pipe - a pipe is exactly
# what let harness_env_scrub_names.bb's own stdin read (a script that
# behaves this way is analysed like any other; `</dev/null` on the probe
# below is the primary fix, but a `for` loop over an already-materialized
# array has no shared stdin left to drain even if a future script found a
# different way in) drain the rest of the file list out from under this
# loop. Comparing $listed against $analysed below is the invariant this
# ticket names directly: a listed script the probe never reached is a
# refusal, never a silent partial pass.
mapfile -t candidate_files < <(changed_bb_files)
listed=0
handoffd_listed=0
for f in "${candidate_files[@]}"; do
  [[ -n "$f" ]] || continue
  listed=$((listed + 1))
  [[ "$(basename "$f")" == "handoffd.bb" ]] && handoffd_listed=1
done

for f in "${candidate_files[@]}"; do
  [[ -n "$f" ]] || continue
  # handoffd.bb is excluded from the plain probe and covered by the BOOT step
  # below instead, and the reason is worth stating: its top level ends in
  # `(def project-root (or (first *command-line-args*) (usage)))`, and `usage`
  # exits. A bare load therefore stops a few forms in, so it would analyse
  # almost none of the file and report a confident pass on the one script whose
  # failure takes the whole swarm down. Booting it reads the file to the end.
  if [[ "$(basename "$f")" == "handoffd.bb" ]]; then
    continue
  fi
  analysed=$((analysed + 1))
  analyse_one "$f"
done

expected_analysed=$((listed - handoffd_listed))
if (( analysed != expected_analysed )); then
  failures+="  loop coverage: listed $listed script(s) (handoffd.bb $([[ $handoffd_listed == 1 ]] && echo booted || echo absent)), analysed $analysed - the guard's own loop never reached $((expected_analysed - analysed)) of them"$'\n'
  status=1
fi

# ── handoffd is BOOTED, not merely analysed (invariant 2) ─────────────────
#
# Analysis catches a forward reference inside a defn only when the whole file
# is read in order; booting it against a throwaway root is the test that
# actually caught 2026-09-04's defect, and it must run on the tree being
# published rather than on a branch.
boot_handoffd() {
  local daemon="$SCRIPTS_DIR/handoffd.bb"
  [[ -f "$daemon" ]] || return 0

  # Per-invocation root, reaped by dead owner pid or age - never a blind
  # prefix sweep (BL-1385/BL-1390).
  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/bb-load-boot-XXXXXX")" || return 0
  printf '%s\n' "$$" > "$work/.fixture-owner-pid" 2>/dev/null || true
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" RETURN
  # BL-1289: the RETURN trap above is the precise cleanup (fires the moment
  # this function returns); this EXIT trap is a redundant backstop for the
  # tempDirTrapGuard convention (which recognises EXIT, not RETURN) - by the
  # time the process exits, $work is already gone, so this rm -rf is a
  # harmless no-op in the normal case.
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" EXIT

  local root="$work/repo"
  mkdir -p "$root/.swarmforge/daemon" "$root/swarmforge" "$root/docs/briefings" \
           "$root/backlog/active" "$root/backlog/paused" "$root/backlog/done" \
           "$root/.swarmforge/handoffs/coordinator/inbox/new" \
           "$root/.swarmforge/handoffs/coordinator/inbox/in_process" \
           "$root/.swarmforge/handoffs/coordinator/inbox/completed" "$root/bin"
  ln -s "$SCRIPTS_DIR" "$root/swarmforge/scripts"
  git_clean init -q -b main "$root" >/dev/null 2>&1
  git_clean -C "$root" config user.email t@t >/dev/null 2>&1
  git_clean -C "$root" config user.name t >/dev/null 2>&1
  git_clean -C "$root" config commit.gpgsign false >/dev/null 2>&1
  echo seed > "$root/seed.txt"
  git_clean -C "$root" add -A >/dev/null 2>&1
  git_clean -C "$root" commit -qm seed >/dev/null 2>&1
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  echo "$root/fake-socket" > "$root/.swarmforge/tmux-socket"
  printf 'Headline: unrelated\n' > "$root/docs/briefings/$(date -u +%Y-%m-%d).md"
  printf 'config active_backlog_max_depth 50\n' > "$root/swarmforge/swarmforge.conf"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$root/bin/tmux"
  chmod +x "$root/bin/tmux"

  local out rc=0
  # The daemon runs git itself, so it is booted with the same scrubbed
  # environment - a leaked GIT_DIR would point its every git call at the
  # checker's repository.
  out="$( cd "$root" && SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$root/bin:$PATH" \
          env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY \
              -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR \
              -u GIT_CEILING_DIRECTORIES -u GIT_PREFIX -u GIT_REFLOG_ACTION \
          timeout "${BB_BOOT_TIMEOUT:-90}" bb "$daemon" "$root" --sweep-once </dev/null 2>&1 )" || rc=$?
  # An analysis banner is a refusal WHATEVER else the output holds, and the
  # ordering matters: babashka echoes the offending source in its `Context`
  # block, so a file whose last line is `(println "sweep-once done")` prints
  # the success marker inside its own error report. A marker-only check reads
  # that as a healthy boot - exactly the false green this guard exists to
  # close, found by the invariant-2 property test.
  local banner=0
  grep -qE '^-+ Error|Unable to resolve symbol|Could not resolve symbol|Could not find namespace' \
    <<<"$out" && banner=1
  if (( banner )) || { (( rc != 0 )) && ! grep -q 'sweep-once done' <<<"$out"; }; then
    failures+="  handoffd.bb: did not boot on this tree - $(grep -E 'Unable to resolve|Exception|error|line' <<<"$out" | head -3 | tr '\n' ' ')"$'\n'
    status=1
  fi
}

boot_handoffd

if (( status != 0 )); then
  echo "BB_LOAD_BLOCK" >&2
  printf 'check_bb_scripts_load: %s Babashka script(s) on this tree fail analysis or boot:\n%s' \
    "$(grep -c . <<<"$failures")" "$failures" >&2
  echo "check_bb_scripts_load: SCI analyses each defn eagerly, so this fails at LOAD - before any function runs. A grep for a label is not proof a file loads." >&2
  exit 1
fi

echo "check_bb_scripts_load: $analysed changed Babashka script(s) analysed, handoffd booted - all clean."
exit 0
