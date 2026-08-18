#!/usr/bin/env bash
# BL-632: refuses a commit or merge-commit on `main` whose staged changes
# touch a QA-exclusive pipeline-code path, unless SWARMFORGE_ROLE=QA.
# Closes the BL-590 post-mortem gap: BL-629 (deploy gate), BL-630 (publish
# gate) and BL-631 (detection) all react to a bad `main` tip that already
# exists - this is the only layer that stops it from existing. Delegated
# to from both swarmforge/git-hooks/pre-commit (plain `git commit`, also
# covers `--amend`) and swarmforge/git-hooks/pre-merge-commit (`git merge
# --no-ff`, the handoff path's merge_and_process shape), per the BL-105
# standalone-script precedent, and callable directly for tests.
#
# The deny path deliberately does not depend on SWARMFORGE_ROLE being set -
# only the QA allowance reads it. A role whose env is lost, or a bare human
# shell, is refused rather than waved through.
#
# The QA-exclusive path set is defined ONCE, here, so a future consumer
# (e.g. BL-631's detector) can read it via --list-paths instead of
# hand-copying the literals into a second place - see BL-632's ticket notes.
#
# Usage: check_pipeline_code_on_main.sh [--list-paths]
#   --list-paths   print the QA-exclusive path set, one per line, and exit 0.
#   (no args)      run the guard against the current branch and staged
#                  changes (git diff --cached). Exits 0 immediately on any
#                  branch other than `main`. Exits 0 when SWARMFORGE_ROLE=QA.
#                  Exits 1, naming the offending path(s) and the remedy,
#                  when a staged change touches a QA-exclusive path and
#                  neither exemption applies. Exits 0 otherwise.

set -euo pipefail

QA_EXCLUSIVE_PATHS=(
  "extension/src/"
  "extension/test/"
  "specs/pipeline/steps/"
)

if [[ "${1:-}" == "--list-paths" ]]; then
  printf '%s\n' "${QA_EXCLUSIVE_PATHS[@]}"
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  exit 0
fi

if [[ "${SWARMFORGE_ROLE:-}" == "QA" ]]; then
  exit 0
fi

touches_qa_exclusive_path() {
  local file="$1"
  local prefix
  for prefix in "${QA_EXCLUSIVE_PATHS[@]}"; do
    case "$file" in
      "$prefix"*) return 0 ;;
    esac
  done
  return 1
}

offenders=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if touches_qa_exclusive_path "$file"; then
    offenders+=("$file")
  fi
done < <(git diff --cached --name-only)

if (( ${#offenders[@]} > 0 )); then
  # BL-925: importing an already-QA-published tip is not a non-QA landing.
  # A merge in progress whose incoming parent is already an ancestor of
  # swarmforge-QA may carry pipeline-code paths - but ONLY when the staged
  # content for each offending path is EXACTLY what that published parent
  # holds. Being mid-merge is never on its own sufficient (invariant 1): a
  # writer could stage fresh pipeline edits on top of a legitimate merge and
  # ride through on its coat-tails, so every offending path's staged content
  # is diffed against the incoming parent - any real difference keeps that
  # path (and only that path) refused below. This reuses BL-630's own
  # QA-ancestry question (git merge-base --is-ancestor against
  # swarmforge-QA) rather than a second definition of "QA-approved tip".
  #
  # Finding the incoming merge parent: .git/MERGE_HEAD is reliable when the
  # merge was explicitly stopped (--no-commit, or a real conflict later
  # completed via `git commit --no-edit` - the pre-commit path) but is NOT
  # written to disk before pre-merge-commit runs for a clean, no-conflict
  # `git merge` (confirmed empirically, git 2.36.1 - the fast path commits
  # in one step and never persists throwaway merge state). For that case,
  # fall back to the GITHEAD_<sha>=<name> environment variables git's own
  # merge machinery sets for each merge parent - the same longstanding
  # contract external merge-driver tools (kdiff3, meld, ...) rely on. Used
  # only when exactly one such variable is present, so an ambiguous or
  # absent signal never grants the exemption (fails closed).
  merge_head_sha="$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
  if [[ -z "$merge_head_sha" ]]; then
    githead_count=0
    githead_candidate=""
    while IFS='=' read -r env_name env_value; do
      case "$env_name" in
        GITHEAD_????????????????????????????????????????)
          githead_candidate="${env_name#GITHEAD_}"
          githead_count=$((githead_count + 1))
          ;;
      esac
    done < <(env)
    if [[ "$githead_count" -eq 1 ]]; then
      merge_head_sha="$githead_candidate"
    fi
  fi
  if [[ -n "$merge_head_sha" ]] && git merge-base --is-ancestor "$merge_head_sha" swarmforge-QA 2>/dev/null; then
    non_matching=()
    for f in "${offenders[@]}"; do
      if [[ -n "$(git diff --cached "$merge_head_sha" -- "$f")" ]]; then
        non_matching+=("$f")
      fi
    done
    offenders=(${non_matching[@]+"${non_matching[@]}"})
  fi
fi

if (( ${#offenders[@]} > 0 )); then
  {
    echo "Commit refused: staged change touches pipeline code on \`main\`:"
    for f in "${offenders[@]}"; do
      echo "  - $f"
    done
    echo
    echo "Pipeline code (${QA_EXCLUSIVE_PATHS[*]}) may only land on main via QA (Article 1.8/4.2, BL-247)."
    echo "Remedy: commit in your own worktree and hand off through the pipeline (swarm_handoff.sh) instead of committing directly to main."
  } >&2
  exit 1
fi

exit 0
