#!/usr/bin/env bash
# BL-1444: refuses landing an art-director-side commit whose OWN content
# leaves the art director's lane. QA lands the art director's tip on its
# note (Article 1.10, human ruling B, 2026-09-06) the way it lands a
# parcel - a real `git merge --no-ff`, through the shared pre-merge-commit
# hook chain every worktree's core.hooksPath points at. Without this guard
# that land is judged by hand.
#
# Lane: a path is in the art director's lane when it is under docs/design/,
# or is a backlog/evidence/ file whose basename contains "art-director". A
# path the tip changes that is OUTSIDE the lane is still exempt when the
# tip's own last commit touching it is reachable from the landed main
# (origin/main when it resolves, else main) - the seat merges origin/main
# every sweep, and a landing branch may lag it (BL-1096's per-path
# provenance shape, check_pipeline_code_on_main.sh).
#
# Two entry modes, one predicate:
#
#   check_art_director_tip.sh [--branch <name>]
#     Hook mode. Resolves the incoming merge parent
#     (incoming_merge_parent_lib.sh). Exits 0 without judging when that
#     commit cannot be resolved, is not reachable from the art director's
#     branch, or IS reachable from the landed main - every other
#     worktree's routine main sync is untouched, and only an
#     art-director-side commit is ever judged (declared invariant 2).
#     Refuses (exit 1), naming every offending path, when a judged tip
#     carries content outside the lane.
#
#   check_art_director_tip.sh --tip <sha> [--branch <name>]
#     Direct mode: judges <sha> against HEAD as the landing branch, with no
#     merge in flight. Prints ART_DIRECTOR_TIP_OK (exit 0) or
#     ART_DIRECTOR_TIP_REFUSED plus the reason (exit 1). A commit not on
#     the art director's branch refuses saying so, before any path is
#     judged.
#
#   check_art_director_tip.sh --print-lane
#     Prints the lane, one entry per line, and exits 0. The --list-paths
#     shape of check_pipeline_code_on_main.sh.
#
# BL-1657: --branch <name> overrides the art-director branch this guard
# judges against (the same flag BL-1459's sibling documenter guard gives
# its own branch); absent it, the branch is resolved from the roster row
# for the art-director seat in .swarmforge/roles.tsv at the current
# repository's top level - the branch that row's own worktree (3rd
# column) has checked out (`git -C <worktree> symbolic-ref --short HEAD`),
# never a hard-coded literal, because the branch name is pack-dependent
# (swarmforge-art-director on this host; primary/art-director on the
# nested pack, which is where the pre-fix literal actually came from and
# why it refused every live tip on this host since 2026-09-06). Absent a
# roster row entirely, the swarmforge-<seat> convention is the last
# resort. A roster row whose worktree cannot be resolved to a branch
# (unreadable, or a detached HEAD), or a final resolved ref that does not
# exist, is a hard refusal in EITHER mode - declared invariant: this
# guard never compares a tip against a branch it did not read from one of
# the three sources above, and every refusal names both the ref and which
# source gave it.
#
# The verdict is a function of git objects (and, for branch resolution,
# roles.tsv) only (declared invariant 1): never SWARMFORGE_ROLE, the
# current branch NAME, the working tree, or who runs it. The guard reads
# only (declared invariant 3): it never writes a file, moves a ref,
# fetches, or pushes.

set -euo pipefail

LANE_DOCS_PREFIX="docs/design/"
LANE_EVIDENCE_PREFIX="backlog/evidence/"
LANE_EVIDENCE_NEEDLE="art-director"

if [[ "${1:-}" == "--print-lane" ]]; then
  printf '%s\n' "$LANE_DOCS_PREFIX"
  printf '%s*%s*\n' "$LANE_EVIDENCE_PREFIX" "$LANE_EVIDENCE_NEEDLE"
  exit 0
fi

# BL-1303 posture (check_feature_handler_registration.sh): a hook runs with
# GIT_DIR (and sometimes GIT_WORK_TREE) already exported by git itself, and
# an inherited value from a wrapping process is the wrong repo for a script
# that resolves paths relative to its own `git rev-parse` calls.
unset GIT_DIR GIT_WORK_TREE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A path is in the lane by prefix (docs/design/) or by prefix-plus-basename-
# substring (backlog/evidence/*art-director*) - never by exact filename, so
# a differently-dated evidence file still matches.
path_in_lane() {
  local p="$1"
  case "$p" in
    "${LANE_DOCS_PREFIX}"*) return 0 ;;
  esac
  case "$p" in
    "${LANE_EVIDENCE_PREFIX}"*)
      local base
      base="$(basename "$p")"
      case "$base" in
        *"${LANE_EVIDENCE_NEEDLE}"*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

# origin/main when it resolves, else main. Neither resolving is
# undeterminable, and this guard fails closed on undeterminable state like
# every other guard in the chain - it is never treated as "nothing to
# compare against, so allow it."
resolve_landed_main() {
  if git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    printf '%s\n' "origin/main"
    return 0
  fi
  if git rev-parse -q --verify main >/dev/null 2>&1; then
    printf '%s\n' "main"
    return 0
  fi
  return 1
}

# The paths <tip> introduces relative to <landing> that are neither in the
# lane nor exempt by provenance. One offending path per line; no output is
# a pass. Provenance: the LAST commit in the tip's own history that touched
# a given path, checked for ancestry of the landed main (BL-1096 shape) -
# never the merge tip standing in for every path.
judge_tip_paths() {
  local landing="$1" tip="$2" landed_main="$3"
  local base path anchor
  base="$(git merge-base "$landing" "$tip")"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    path_in_lane "$path" && continue
    anchor="$(git log -1 --format=%H "$tip" -- "$path" 2>/dev/null || true)"
    if [[ -n "$anchor" ]] && git merge-base --is-ancestor "$anchor" "$landed_main" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "$path"
  done < <(git diff --name-only "$base" "$tip")
  return 0
}

# BL-1657: the roster row's worktree column (3rd, tab-separated) for the
# seat "art-director" in .swarmforge/roles.tsv, at the current
# repository's top level - the same awk idiom sweep_all_inbox.sh uses
# over the same file, matched by seat name instead of pack.
resolve_art_director_worktree_from_roles_tsv() {
  local top roles_tsv
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$top" ]] || return 1
  roles_tsv="$top/.swarmforge/roles.tsv"
  [[ -r "$roles_tsv" ]] || return 1
  awk -F'\t' '$1 == "art-director" { print $3; found=1; exit } END { exit !found }' "$roles_tsv"
}

# Resolves the art-director branch in order: an explicit --branch
# override; else the roster row's own worktree, read for the branch it
# has checked out; else the swarmforge-<seat> convention as a last
# resort (no roster row at all). Prints "<ref>\t<source>" and returns 0
# on success. A roster row whose worktree cannot be resolved to a branch
# (unreadable, or detached) is a hard failure here - never a silent
# fall-through to the convention name, which would compare tips against
# a branch the roster does not actually say is live; prints the reason
# and returns 1.
resolve_art_director_ref() {
  if [[ -n "$BRANCH_OVERRIDE" ]]; then
    printf '%s\t%s\n' "$BRANCH_OVERRIDE" "--branch"
    return 0
  fi
  local worktree branch
  if worktree="$(resolve_art_director_worktree_from_roles_tsv)"; then
    if branch="$(git -C "$worktree" symbolic-ref --short HEAD 2>/dev/null)" && [[ -n "$branch" ]]; then
      printf '%s\t%s\n' "$branch" "roles.tsv worktree $worktree"
      return 0
    fi
    printf 'the roles.tsv art-director worktree %s could not be resolved to a branch (detached HEAD or unreadable)\n' "$worktree"
    return 1
  fi
  printf '%s\t%s\n' "swarmforge-art-director" "the swarmforge-<seat> convention (no roles.tsv row for art-director)"
  return 0
}

lane_statement() {
  echo "An art director tip may carry only docs/design/ and its own evidence (backlog/evidence/*art-director*)."
}

refuse_direct() {
  echo "ART_DIRECTOR_TIP_REFUSED"
  echo "$1"
  exit 1
}

# ── argument parsing (both modes share --branch) ────────────────────────
MODE=""
TIP=""
BRANCH_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tip)
      MODE="direct"
      TIP="${2:?Usage: check_art_director_tip.sh --tip <sha> [--branch <name>]}"
      shift 2
      ;;
    --branch)
      BRANCH_OVERRIDE="${2:?Usage: check_art_director_tip.sh [--tip <sha>] --branch <name>}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ "$MODE" == "direct" ]]; then
  FULL_TIP="$(git rev-parse -q --verify "${TIP}^{commit}" 2>/dev/null || true)"
  if [[ -z "$FULL_TIP" ]]; then
    refuse_direct "$TIP does not resolve to a commit."
  fi
  RESOLVED=""
  if ! RESOLVED="$(resolve_art_director_ref)"; then
    refuse_direct "the art-director branch could not be resolved: $RESOLVED"
  fi
  ART_DIRECTOR_REF="${RESOLVED%%$'\t'*}"
  ART_DIRECTOR_SOURCE="${RESOLVED#*$'\t'}"
  if ! git rev-parse -q --verify "${ART_DIRECTOR_REF}^{commit}" >/dev/null 2>&1; then
    refuse_direct "$ART_DIRECTOR_REF (resolved from $ART_DIRECTOR_SOURCE) does not exist."
  fi
  if ! git merge-base --is-ancestor "$FULL_TIP" "$ART_DIRECTOR_REF" 2>/dev/null; then
    refuse_direct "$FULL_TIP is not on $ART_DIRECTOR_REF (resolved from $ART_DIRECTOR_SOURCE)."
  fi
  LANDED_MAIN="$(resolve_landed_main || true)"
  if [[ -z "$LANDED_MAIN" ]]; then
    refuse_direct "no landed-main ref (origin/main or main) resolves, so provenance cannot be judged."
  fi
  LANDING="$(git rev-parse HEAD)"
  OFFENDERS="$(judge_tip_paths "$LANDING" "$FULL_TIP" "$LANDED_MAIN")"
  if [[ -n "$OFFENDERS" ]]; then
    REASON="$(lane_statement) Offending path(s):"
    while IFS= read -r p; do
      REASON="$REASON
  - $p"
    done <<< "$OFFENDERS"
    refuse_direct "$REASON"
  fi
  echo "ART_DIRECTOR_TIP_OK"
  exit 0
fi

# ── hook mode ────────────────────────────────────────────────────────────
# shellcheck source=incoming_merge_parent_lib.sh
source "$SCRIPT_DIR/incoming_merge_parent_lib.sh"
INCOMING="$(resolve_incoming_merge_parent || true)"
if [[ -z "$INCOMING" ]]; then
  exit 0
fi
RESOLVED=""
if ! RESOLVED="$(resolve_art_director_ref)"; then
  echo "Merge refused: check_art_director_tip.sh could not resolve the art-director branch: $RESOLVED" >&2
  exit 1
fi
ART_DIRECTOR_REF="${RESOLVED%%$'\t'*}"
ART_DIRECTOR_SOURCE="${RESOLVED#*$'\t'}"
if ! git rev-parse -q --verify "${ART_DIRECTOR_REF}^{commit}" >/dev/null 2>&1; then
  echo "Merge refused: check_art_director_tip.sh's resolved art-director branch $ART_DIRECTOR_REF (from $ART_DIRECTOR_SOURCE) does not exist." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$INCOMING" "$ART_DIRECTOR_REF" 2>/dev/null; then
  exit 0
fi
LANDED_MAIN="$(resolve_landed_main || true)"
if [[ -n "$LANDED_MAIN" ]] && git merge-base --is-ancestor "$INCOMING" "$LANDED_MAIN" 2>/dev/null; then
  exit 0
fi
if [[ -z "$LANDED_MAIN" ]]; then
  echo "Merge refused: check_art_director_tip.sh could not resolve a landed-main ref (origin/main or main) to judge provenance." >&2
  exit 1
fi

LANDING="$(git rev-parse HEAD)"
OFFENDERS="$(judge_tip_paths "$LANDING" "$INCOMING" "$LANDED_MAIN")"
if [[ -n "$OFFENDERS" ]]; then
  {
    echo "Merge refused: the art-director tip $INCOMING carries content outside its lane:"
    while IFS= read -r p; do
      echo "  - $p"
    done <<< "$OFFENDERS"
    echo
    lane_statement
  } >&2
  exit 1
fi

exit 0
