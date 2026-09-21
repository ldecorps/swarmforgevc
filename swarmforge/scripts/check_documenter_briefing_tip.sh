#!/usr/bin/env bash
# BL-1459: refuses landing a documenter-side commit whose OWN content
# leaves the day's-briefing lane, or that re-lands a briefing for a date
# the landed main already carries. QA lands the documenter's briefing tip
# on its note (human ruling A, 2026-09-07; landing path per ruling B,
# 2026-09-06/BL-1444) the way it lands the art director's tip - a real
# `git merge --no-ff`, through the shared pre-merge-commit hook chain
# every worktree's core.hooksPath points at. Without this guard that land
# is judged by hand (BL-1459's own history: cherry-picked by hand
# 2026-09-05, committed directly on main 2026-09-06, or not sent at all).
#
# Lane: unlike check_art_director_tip.sh's PREFIX lane (docs/design/, any
# file), this lane is exactly ONE date's pair - docs/briefings/<date>.md
# and, optionally, docs/briefings/<date>.json - where <date> is whichever
# single date the judged tip's own diff names. A tip naming zero or more
# than one distinct docs/briefings/<date>.md path resolves no lane at
# all, so EVERY changed path is judged outside it (fail closed - a guard
# that cannot determine which day is landing never guesses). Everything
# else, including docs/briefings/.sent.json (the email sweep's own
# sent-state, never the landing lane) and any path outside docs/briefings/
# entirely, is exempt only by provenance: a tip path whose own blob
# equals the landed main's blob there is main's content riding along
# whatever the commit ancestry (BL-1666, 2026-09-21 - a hand-built
# tip-pure land-step replay lands content through a fresh commit off
# main, never an ancestor of the pipeline commit that first authored
# it); failing that, a path whose own last touching commit is already
# reachable from the landed main (BL-1096 shape, same as
# check_art_director_tip.sh) is exempt too. A path whose blob differs
# from, or is absent on, the landed main and fails the ancestry test is
# refused.
#
# The additional invariant BL-1444's lane has no equivalent for: a day has
# AT MOST ONE landed briefing. Even a byte-identical or different-content
# docs/briefings/<date>.md is refused when the landed main already carries
# a blob at that path - never merged over, never a second text for a day
# the human was already sent (BL-406's shape, for compose rather than
# send).
#
# Two entry modes, one predicate:
#
#   check_documenter_briefing_tip.sh [--branch <name>]
#     Hook mode. Resolves the incoming merge parent
#     (incoming_merge_parent_lib.sh). Exits 0 without judging when that
#     commit cannot be resolved, is not reachable from the documenter's
#     branch, or IS reachable from the landed main - every other
#     worktree's routine main sync is untouched, and only a
#     documenter-side commit is ever judged (declared invariant 2).
#     Refuses (exit 1), naming every offending path, when a judged tip
#     carries content outside the lane or re-lands an already-landed day.
#
#   check_documenter_briefing_tip.sh --tip <sha> [--branch <name>]
#     Direct mode: judges <sha> against HEAD as the landing branch, with no
#     merge in flight. Prints DOCUMENTER_BRIEFING_TIP_OK (exit 0) or
#     DOCUMENTER_BRIEFING_TIP_REFUSED plus the reason (exit 1). A commit
#     not on the documenter's branch refuses saying so, before any path is
#     judged.
#
# --branch <name> overrides the documenter branch this guard judges
# against; absent it, the branch is read from .swarmforge/roles.tsv (the
# "session" column, 4th field, of the row whose 1st field is "documenter")
# at the current repository's top level - the SAME per-worktree file
# handoffd.bb itself reads, never a hard-coded name, because the
# documenter's branch is pack-dependent (swarmforge-documenter on this
# host; primary/documenter on the nested pack, per this ticket's own
# direction).
#
# The verdict is a function of git objects (and, for branch resolution,
# roles.tsv) only: never SWARMFORGE_ROLE, the current branch NAME, the
# working tree, or who runs it. The guard reads only: it never writes a
# file, moves a ref, fetches, or pushes.

set -euo pipefail

BRIEFINGS_DIR="docs/briefings/"
SENT_JSON_PATH="docs/briefings/.sent.json"

if [[ "${1:-}" == "--print-lane" ]]; then
  printf '%s<date>.md\n' "$BRIEFINGS_DIR"
  printf '%s<date>.json (same date only)\n' "$BRIEFINGS_DIR"
  exit 0
fi

# BL-1303 posture (check_feature_handler_registration.sh, mirrored by
# check_art_director_tip.sh): a hook runs with GIT_DIR (and sometimes
# GIT_WORK_TREE) already exported by git itself, and an inherited value
# from a wrapping process is the wrong repo for a script that resolves
# paths relative to its own `git rev-parse` calls.
unset GIT_DIR GIT_WORK_TREE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# origin/main when it resolves, else main. Neither resolving is
# undeterminable, and this guard fails closed on undeterminable state like
# every other guard in the chain.
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

# .swarmforge/roles.tsv's "session" column (4th, tab-separated) for the
# row whose 1st field is "documenter" - the same file/column
# handoffd.bb's own roles-file parsing reads. Resolved at the current
# repository's top level, never a hard-coded relative path, so this works
# the same whether the guard runs from a hook (cwd is the worktree root)
# or invoked directly from anywhere inside the repo.
resolve_documenter_branch_from_roles_tsv() {
  local top roles_tsv
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$top" ]] || return 1
  roles_tsv="$top/.swarmforge/roles.tsv"
  [[ -r "$roles_tsv" ]] || return 1
  awk -F'\t' '$1 == "documenter" { print $4; found=1; exit } END { exit !found }' "$roles_tsv"
}

# The single date named by the tip's own docs/briefings/<date>.md
# path(s), or nothing when the tip names zero or more than one distinct
# date - a guard that cannot determine which day is landing never
# guesses at a lane, so every changed path is then judged outside it.
find_briefing_date() {
  local base="$1" tip="$2"
  local dates count
  dates="$( (git diff --name-only "$base" "$tip" \
    | grep -E '^docs/briefings/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' \
    | sed -E 's#^docs/briefings/([0-9]{4}-[0-9]{2}-[0-9]{2})\.md$#\1#' \
    | sort -u) || true )"
  count="$(printf '%s\n' "$dates" | grep -c . || true)"
  if [[ "$count" -eq 1 ]]; then
    printf '%s\n' "$dates"
  fi
  return 0
}

path_in_lane() {
  local p="$1" date="$2"
  [[ -n "$date" ]] || return 1
  [[ "$p" == "${BRIEFINGS_DIR}${date}.md" || "$p" == "${BRIEFINGS_DIR}${date}.json" ]]
}

# The paths <tip> introduces relative to <landing> that are neither in the
# lane nor exempt by provenance. One offending path per line; no output is
# a pass for THIS check alone (the already-landed-day check is separate,
# below).
#
# BL-1666 amendment (2026-09-21, specifier ruling on QA note 003047): a
# path is exempt when the TIP's own blob at that path equals the LANDED
# MAIN's blob there, whatever the commit ancestry - checked FIRST. A
# hand-built tip-pure land-step replay (condition (g)) lands content on
# origin/main through a FRESH commit built off origin/main, never an
# ancestor of the pipeline commit that originally authored it; the
# ancestry-only check below (BL-1096 shape, identical to
# check_art_director_tip.sh's judge_tip_paths) then wrongly refused
# byte-identical content as unprovenanced. The ancestry test stays as the
# SECOND exemption, unchanged, for a path the tip removed (no blob to
# compare) or a tree entry with no blob (a gitlink). A path whose blob
# differs from, or is absent on, the landed main falls through to that
# same ancestry test exactly as before - this amendment only ADDS a way
# to exempt, it narrows nothing.
judge_tip_paths() {
  local landing="$1" tip="$2" landed_main="$3" date="$4"
  local base path anchor tip_blob main_blob
  base="$(git merge-base "$landing" "$tip")"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    path_in_lane "$path" "$date" && continue
    tip_blob="$(git rev-parse -q --verify "${tip}:${path}" 2>/dev/null || true)"
    main_blob="$(git rev-parse -q --verify "${landed_main}:${path}" 2>/dev/null || true)"
    if [[ -n "$tip_blob" && -n "$main_blob" && "$tip_blob" == "$main_blob" ]]; then
      continue
    fi
    anchor="$(git log -1 --format=%H "$tip" -- "$path" 2>/dev/null || true)"
    if [[ -n "$anchor" ]] && git merge-base --is-ancestor "$anchor" "$landed_main" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "$path"
  done < <(git diff --name-only "$base" "$tip")
  return 0
}

# True (prints the offending path) when the landed main already carries a
# blob at docs/briefings/<date>.md - a day has at most one landed
# briefing, regardless of byte content, never provenance-exempt (landing
# the SAME date twice is exactly what this check exists to refuse, even
# when the second attempt's own last-touch happens to already be an
# ancestor of main from some other angle).
already_landed_day() {
  local landed_main="$1" date="$2"
  [[ -n "$date" ]] || return 1
  git rev-parse -q --verify "${landed_main}:${BRIEFINGS_DIR}${date}.md" >/dev/null 2>&1
}

lane_statement() {
  echo "A documenter briefing tip may carry only docs/briefings/<date>.md and its own docs/briefings/<date>.json (same date), never docs/briefings/.sent.json."
}

refuse_direct() {
  echo "DOCUMENTER_BRIEFING_TIP_REFUSED"
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
      TIP="${2:?Usage: check_documenter_briefing_tip.sh --tip <sha> [--branch <name>]}"
      shift 2
      ;;
    --branch)
      BRANCH_OVERRIDE="${2:?Usage: check_documenter_briefing_tip.sh [--tip <sha>] --branch <name>}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

resolve_documenter_branch() {
  if [[ -n "$BRANCH_OVERRIDE" ]]; then
    printf '%s\n' "$BRANCH_OVERRIDE"
    return 0
  fi
  resolve_documenter_branch_from_roles_tsv
}

if [[ "$MODE" == "direct" ]]; then
  FULL_TIP="$(git rev-parse -q --verify "${TIP}^{commit}" 2>/dev/null || true)"
  if [[ -z "$FULL_TIP" ]]; then
    refuse_direct "$TIP does not resolve to a commit."
  fi
  DOCUMENTER_BRANCH="$(resolve_documenter_branch || true)"
  if [[ -z "$DOCUMENTER_BRANCH" ]]; then
    refuse_direct "the documenter branch could not be resolved (.swarmforge/roles.tsv missing/unreadable and no --branch given)."
  fi
  if ! git merge-base --is-ancestor "$FULL_TIP" "$DOCUMENTER_BRANCH" 2>/dev/null; then
    refuse_direct "$FULL_TIP is not on $DOCUMENTER_BRANCH."
  fi
  LANDED_MAIN="$(resolve_landed_main || true)"
  if [[ -z "$LANDED_MAIN" ]]; then
    refuse_direct "no landed-main ref (origin/main or main) resolves, so provenance cannot be judged."
  fi
  LANDING="$(git rev-parse HEAD)"
  BASE="$(git merge-base "$LANDING" "$FULL_TIP")"
  DATE="$(find_briefing_date "$BASE" "$FULL_TIP" || true)"
  if already_landed_day "$LANDED_MAIN" "$DATE"; then
    refuse_direct "docs/briefings/${DATE}.md already on main"
  fi
  OFFENDERS="$(judge_tip_paths "$LANDING" "$FULL_TIP" "$LANDED_MAIN" "$DATE")"
  if [[ -n "$OFFENDERS" ]]; then
    REASON="$(lane_statement) Offending path(s):"
    while IFS= read -r p; do
      REASON="$REASON
  - $p"
    done <<< "$OFFENDERS"
    refuse_direct "$REASON"
  fi
  echo "DOCUMENTER_BRIEFING_TIP_OK"
  exit 0
fi

# ── hook mode ────────────────────────────────────────────────────────────
# shellcheck source=incoming_merge_parent_lib.sh
source "$SCRIPT_DIR/incoming_merge_parent_lib.sh"
INCOMING="$(resolve_incoming_merge_parent || true)"
if [[ -z "$INCOMING" ]]; then
  exit 0
fi
DOCUMENTER_BRANCH="$(resolve_documenter_branch || true)"
if [[ -z "$DOCUMENTER_BRANCH" ]]; then
  exit 0
fi
LANDED_MAIN="$(resolve_landed_main || true)"
if [[ -z "$LANDED_MAIN" ]]; then
  echo "Merge refused: check_documenter_briefing_tip.sh could not resolve a landed-main ref (origin/main or main) to judge provenance." >&2
  exit 1
fi
if git merge-base --is-ancestor "$INCOMING" "$LANDED_MAIN" 2>/dev/null; then
  exit 0
fi
# BL-1459 spec-gap fix (specifier ruling, 2026-09-20; supersedes the
# coder's own exact-tip hotfix f46bd22ab1, folded into this lineage and
# replaced here). The predicate is FIRST-PARENT membership: INCOMING is
# judged iff it is on the documenter branch's own first-parent line since
# landed main. Plain ancestry (check_art_director_tip.sh's own pattern,
# tried here first) is wrong for a CHAIN role: the documenter is the last
# pipeline stage, so its branch reaches every upstream commit any earlier
# role ever forwarded, behind a SECOND parent of an ordinary "Merge X into
# documenter" - observed live: a cleaner->coder bounce commit with nothing
# to do with docs/briefings/ was refused wholesale because it arrived on
# swarmforge-documenter through the ordinary cleaner->architect->
# hardener->documenter merge chain (BL-1241's "legitimate YES", not a
# defect). Exact-tip equality (the coder's own first attempt) was too
# NARROW the other way: it silently stops judging the instant the
# documenter branch advances even one commit past the tip a landing note
# named - a missed enforcement. First-parent membership gets both right:
# an upstream chain commit sits behind a second parent and is never on
# this list; a documenter commit that is no longer the tip still is.
#
# BL-1666: the list is captured into a variable and grepped from there,
# never piped straight into grep -q - under set -o pipefail, grep -q
# exits at its first match while git rev-list may still be writing a
# long list, killing the producer with SIGPIPE; the pipeline's own exit
# status (141) then reads as "not on the line", silently skipping
# judgment on real briefing content under load (BL-1660's shape).
FIRST_PARENT_LIST="$(git rev-list --first-parent "${LANDED_MAIN}..${DOCUMENTER_BRANCH}" 2>/dev/null || true)"
if ! grep -qx "$INCOMING" <<<"$FIRST_PARENT_LIST"; then
  exit 0
fi

LANDING="$(git rev-parse HEAD)"
BASE="$(git merge-base "$LANDING" "$INCOMING")"

# BL-1459 CRITICAL fix (QA note 003000, specifier ruling, 2026-09-20):
# core.hooksPath runs pre-merge-commit from the MERGED tree, so THIS
# parcel's own guard enforces itself on the very merge that delivers it -
# and the documenter mostly sends ORDINARY PARCEL FORWARDS to QA (this
# guard's own git_handoff among them), never a briefing land. Without a
# content trigger, "is this a documenter-side, first-parent, not-yet-
# landed commit" is true for EVERY one of those, and judge_tip_paths then
# refuses it for carrying dozens of paths outside docs/briefings/ - QA's
# CRITICAL report: every ordinary documenter forward to QA was blocked.
# The art director's own template (BL-1444) never needed this: the art
# director sends nothing but tip-lands. The documenter sends both; only a
# commit whose OWN delivered content touches docs/briefings/ is a
# briefing land at all.
#
# BL-1666: same SIGPIPE-under-pipefail shape as the first-parent check
# above - a diff with many changed paths can still be writing when
# grep -q's first match arrives, so the diff is captured whole first.
INCOMING_DIFF_PATHS="$(git diff --name-only "$BASE" "$INCOMING" 2>/dev/null || true)"
if ! grep -q "^${BRIEFINGS_DIR}" <<<"$INCOMING_DIFF_PATHS"; then
  exit 0
fi

DATE="$(find_briefing_date "$BASE" "$INCOMING" || true)"
if already_landed_day "$LANDED_MAIN" "$DATE"; then
  echo "Merge refused: docs/briefings/${DATE}.md already on main - a day has at most one landed briefing." >&2
  exit 1
fi

OFFENDERS="$(judge_tip_paths "$LANDING" "$INCOMING" "$LANDED_MAIN" "$DATE")"
if [[ -n "$OFFENDERS" ]]; then
  {
    echo "Merge refused: the documenter briefing tip $INCOMING carries content outside its lane:"
    while IFS= read -r p; do
      echo "  - $p"
    done <<< "$OFFENDERS"
    echo
    lane_statement
  } >&2
  exit 1
fi

exit 0
