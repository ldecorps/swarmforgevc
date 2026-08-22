#!/usr/bin/env bash
# BL-925 invariant 2: the ONE definition of "is <sha> a QA-approved tip" -
# shared by check_pipeline_code_on_main.sh (bash, direct call),
# handoffd.bb's push-sweep gate, and babysitter_check.bb's
# pipeline-code-on-main gather (both Babashka, via process/sh), so a change
# to the approval predicate has exactly one call site to update. A "kept in
# sync" comment across that language boundary is not a gate (engineering
# article's constant-across-a-language-boundary rule); this extraction is
# the gate.
#
# BL-952: "reachable from swarmforge-QA" alone is NOT approval. QA merges a
# parcel into that ref in order to REVIEW it, so a parcel QA then BOUNCES
# stays reachable forever and read as approved to every consumer - BL-945's
# twice-bounced code rode onto origin/main exactly this way. Approval is
# now ancestry AND the durable bounce verdict QA already writes:
#   - the machine-local JSONL store record-bounce.js appends
#     (.swarmforge/bounces/<YYYY-MM>.jsonl, matched on the record's 10-hex
#     commit field), and
#   - the tracked ticket-YAML bounce_history entries (backlog/**), matched
#     on their inline-map "by: ... commit: <10-hex>" shape
# - EITHER store naming the sha vetoes approval (each store has missed
# entries the other held; a safety gate unions them). A sha with no bounce
# record anywhere is clean - an absent store means "no bounce ever
# recorded", never an error - but a store that EXISTS and cannot be
# consulted (obstructed path, unreadable file, a record line that does not
# parse) is an undeterminable verdict and fails CLOSED (invariant 3:
# unknown is never approved).
#
# Exit codes:
#   0 = approved: an ancestor of swarmforge-QA AND no bounce verdict on file
#   1 = a clean "no" (not an ancestor, or QA bounced it - the bounce case
#       prints a "bounced:" line to stderr so callers can name the parcel)
#   anything else = undeterminable - an unresolvable sha, a missing
#       swarmforge-QA ref, or an unreadable/corrupt verdict store; the
#       cause is printed to stderr and callers must fail closed, never
#       reading this as either yes or no.
#
# Operates on the CALLER's current working directory, never this script's
# own location: check_pipeline_code_on_main.sh already `cd`s to its target
# repo before calling this, and the Babashka callers spawn it with :dir set
# to project-root - both must check ancestry AND verdicts in that repo, not
# in wherever this script happens to live.
#
# Usage: is_qa_ancestor.sh <sha>
set -euo pipefail

SHA="${1:?Usage: is_qa_ancestor.sh <sha>}"

# Shared by both bounce-store checks below: a token is a verdict on FULL_SHA
# exactly when the full sha starts with it (records abbreviate to whatever
# length the recorder used, so prefix match, never string equality).
match_bounce_token() {
  local token="$1" message="$2"
  case "$FULL_SHA" in
    "$token"*)
      echo "bounced: $SHORT_SHA $message (recorded as $token) - a bounced parcel never reads as approved (BL-952)" >&2
      exit 1
      ;;
  esac
}

# ── the sha itself must resolve (invariant 3: an unresolvable commit is an
#    undeterminable verdict, never a clean "no") ──────────────────────────
if ! FULL_SHA="$(git rev-parse --verify -q "${SHA}^{commit}" 2>/dev/null)"; then
  echo "is_qa_ancestor.sh: undeterminable - commit '$SHA' does not resolve" >&2
  exit 2
fi
SHORT_SHA="$(printf '%s' "$FULL_SHA" | cut -c1-10)"

# ── bounce verdict: the JSONL store record-bounce.js appends ──────────────
BOUNCES_DIR=".swarmforge/bounces"
if [[ -e "$BOUNCES_DIR" && ! -d "$BOUNCES_DIR" ]]; then
  echo "is_qa_ancestor.sh: undeterminable - verdict store $BOUNCES_DIR exists but is not a directory (missing/obstructed record store)" >&2
  exit 2
fi
if [[ -d "$BOUNCES_DIR" ]]; then
  for f in "$BOUNCES_DIR"/*.jsonl; do
    [[ -e "$f" ]] || continue  # bash 3.2: unmatched glob stays literal
    if [[ ! -r "$f" ]]; then
      echo "is_qa_ancestor.sh: undeterminable - verdict store $f is unreadable" >&2
      exit 2
    fi
    # Every non-empty line must carry the record shape; a line that does
    # not is a corrupt record and the verdict cannot be trusted either way.
    # The commit field is 7-40 hex chars: the LIVE store holds abbreviated
    # records (a real 9-char row measured 2026-08-19), so demanding exactly
    # 10 would read the whole store as corrupt and freeze every publish -
    # the gate-that-strands-a-legitimate-send failure invariant 1 warns
    # against.
    if grep -v -E '^\{.*"commit":"[0-9a-fA-F]{7,40}".*\}$' "$f" | grep -q -E '.'; then
      echo "is_qa_ancestor.sh: undeterminable - verdict store $f holds a corrupt record line" >&2
      exit 2
    fi
    while IFS= read -r token; do
      [[ -n "$token" ]] || continue
      match_bounce_token "$token" "has a QA bounce verdict on file ($f)"
    done < <(grep -oE '"commit":"[0-9a-fA-F]{7,40}"' "$f" | sed -E 's/"commit":"([0-9a-fA-F]+)"/\1/')
  done
fi

# ── bounce verdict: tracked ticket-YAML bounce_history entries ────────────
# The inline-map shape record-bounce writes:
#   - { at: ..., by: <role>, ..., commit: <10-hex>, evidence: ... }
# Matched with the by:/commit: pair on one line so ordinary prose that
# happens to say "commit:" never false-positives.
if [[ -d backlog ]]; then
  # Same prefix tolerance as the JSONL store: extract each entry's recorded
  # commit field (the inline-map "by: ... commit: <hex>" shape record-bounce
  # writes) and prefix-match it against the full sha.
  while IFS= read -r token; do
    [[ -n "$token" ]] || continue
    match_bounce_token "$token" "appears in a ticket's bounce_history"
  done < <(grep -rh -E 'by: [a-zA-Z]+.*commit: [0-9a-fA-F]{7,40}' backlog --include='*.yaml' 2>/dev/null \
             | sed -E 's/.*commit: ([0-9a-fA-F]+).*/\1/')
fi

# ── approval: an expedite run's own QA-hat verdict (BL-1025) ──────────────
# The SECOND constitutionally sanctioned way pipeline code reaches main
# ("Same gates, no machinery", BL-567). An expedite run walks the same role
# hats - its QA hat gives a real advance-or-bounce verdict - but with the
# swarm stopped there is no live QA worktree, so swarmforge-QA never moves
# and the ancestry test below can only ever answer "no". Three commits from
# BL-1021's run tripped the Article 4.2 CRIT on 2026-08-21 for exactly that
# reason.
#
# Read here, alongside ancestry, rather than by teaching each caller a second
# rule (BL-925 invariant 2: ONE approval predicate). Checked AFTER the bounce
# stores above, so a bounce still vetoes both approval routes.
#
# Only an APPROVING verdict approves. A record whose verdict is a bounce is a
# verdict on file that says no - it must not read as approval, and it must
# not read as absence either. And nothing weaker than a record counts: this
# never looks at the commit MESSAGE, so a subject claiming an expedite run
# buys exactly nothing (BL-972 - commit-subject matching standing in for a
# real gate is a failure this repo has already had once).
#
# Same fail-closed discipline as the bounce stores: absent means "no expedite
# run ever approved this" and falls through to ancestry, but a store that
# EXISTS and cannot be consulted is undeterminable (invariant 3).
EXPEDITE_DIR=".swarmforge/expedite-approvals"
if [[ -e "$EXPEDITE_DIR" && ! -d "$EXPEDITE_DIR" ]]; then
  echo "is_qa_ancestor.sh: undeterminable - expedite verdict store $EXPEDITE_DIR exists but is not a directory (missing/obstructed record store)" >&2
  exit 2
fi
if [[ -d "$EXPEDITE_DIR" ]]; then
  for f in "$EXPEDITE_DIR"/*.jsonl; do
    [[ -e "$f" ]] || continue  # bash 3.2: unmatched glob stays literal
    if [[ ! -r "$f" ]]; then
      echo "is_qa_ancestor.sh: undeterminable - expedite verdict store $f is unreadable" >&2
      exit 2
    fi
    # Every non-empty line must carry BOTH fields the verdict is made of. A
    # line missing either is a corrupt record and the store cannot be
    # trusted either way - the same prefix tolerance on the commit field as
    # the bounce stores, for the same reason (recorders abbreviate).
    if grep -v -E '^\{.*"commit":"[0-9a-fA-F]{7,40}".*\}$' "$f" | grep -q -E '.'; then
      echo "is_qa_ancestor.sh: undeterminable - expedite verdict store $f holds a record line with no commit field" >&2
      exit 2
    fi
    if grep -v -E '^\{.*"verdict":"[a-zA-Z-]+".*\}$' "$f" | grep -q -E '.'; then
      echo "is_qa_ancestor.sh: undeterminable - expedite verdict store $f holds a record line with no verdict field" >&2
      exit 2
    fi
    # The advance vocabulary is expedite_lib.bb's own `advance-verdicts`.
    while IFS= read -r token; do
      [[ -n "$token" ]] || continue
      case "$FULL_SHA" in
        "$token"*)
          echo "approved: $SHORT_SHA has an expedite QA-hat approval on file ($f, recorded as $token) - BL-1025" >&2
          exit 0
          ;;
      esac
    done < <(grep -E '"verdict":"(pass|forward|approved)"' "$f" \
               | grep -oE '"commit":"[0-9a-fA-F]{7,40}"' \
               | sed -E 's/"commit":"([0-9a-fA-F]+)"/\1/')
  done
fi

# ── ancestry (unchanged from BL-925): git's own exit code passes through -
#    0 ancestor, 1 clean no, anything else a real failure callers must
#    fail closed on ──────────────────────────────────────────────────────
exec git merge-base --is-ancestor "$FULL_SHA" swarmforge-QA
