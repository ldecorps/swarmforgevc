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
#        is_qa_ancestor.sh --batch <sha>...      (BL-1086)
#        is_qa_ancestor.sh --batch               (shas on stdin, one per line)
#
# BL-1086 batch mode. babysitterd's pipeline-code-on-main gather asked this
# question once per SHA, one bash process each, and every one of those
# processes re-scanned the whole bounce store and grepped the entire backlog
# tree. On a `main` sitting ~23 commits ahead that check overran babysitterd's
# 600s freshness threshold - and because the daemon writes its heartbeat only
# AFTER the check returns, a slow gather is indistinguishable from a dead
# daemon, so it got RESTARTED mid-sweep (age_secs=1146, 2026-08-22).
#
# Batch mode answers the same question for many SHAs in ONE process: the
# verdict stores are read once and every SHA is answered against them. This is
# the same predicate, not a second one - BL-925 invariant 2 holds literally,
# because there is still exactly one place in the tree that decides approval.
# Single-SHA mode is a batch of one and shares the same code path, so the two
# cannot drift.
#
# Batch output: one `<sha-as-given> <code>` line per input SHA on stdout, in
# input order, where code is the same 0/1/2 vocabulary a single run exits
# with. Batch mode itself exits 0 when every SHA got an answer; a STORE-level
# problem (unreadable, corrupt, obstructed) still fails the whole run with
# exit 2 and no output, because that is undeterminable for every SHA at once.
set -euo pipefail

BATCH_MODE="no"
BATCH_SHAS=()
if [[ "${1:-}" == "--batch" ]]; then
  BATCH_MODE="yes"
  shift
  if [[ $# -gt 0 ]]; then
    BATCH_SHAS=("$@")
  else
    # ${arr[@]+"${arr[@]}"} throughout: stock macOS /bin/bash 3.2 raises
    # "unbound variable" expanding an EMPTY array under set -u (BL-801).
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      BATCH_SHAS+=("$line")
    done
  fi
else
  SHA="${1:?Usage: is_qa_ancestor.sh <sha> | is_qa_ancestor.sh --batch <sha>...}"
fi

# Shared by both bounce-store checks below: a token is a verdict on FULL_SHA
# exactly when the full sha starts with it (records abbreviate to whatever
# length the recorder used, so prefix match, never string equality).
match_bounce_token() {
  local token="$1" message="$2"
  case "$FULL_SHA" in
    "$token"*)
      echo "bounced: $SHORT_SHA $message (recorded as $token) - a bounced parcel never reads as approved (BL-952)" >&2
      return 1
      ;;
  esac
  return 0
}

# ── verdict stores, read ONCE (BL-1086) ───────────────────────────────────
# Every check below used to run per invocation, which meant per SHA: a full
# scan of the bounce JSONL store and a recursive grep of the whole backlog
# tree. Reading them once and matching every SHA against the result is the
# whole of this ticket's part 2. The CHECKS are unchanged, including every
# fail-closed exit and every message - only how often they run.
BOUNCE_TOKENS=""
EXPEDITE_TOKENS=""
YAML_TOKENS=""
# BL-1334: the land step's replay->approved-source mapping. Same posture as
# EXPEDITE_TOKENS - a durable record read AFTER the bounce vetoes - so this
# stays ONE predicate with one more approval path, never a second definition
# of approval (BL-925 invariant 2).
LAND_TOKENS=""
# Set when the expedite store cannot be consulted. Raised per sha, AFTER the
# bounce checks, so the original ordering survives batching (see below).
EXPEDITE_PROBLEM=""
# Same deferred-raise posture as EXPEDITE_PROBLEM, and for the same reason:
# a bounce on file must still answer a clean "no" even when this store is
# unreadable.
LAND_PROBLEM=""

collect_verdict_stores() {
  # ── bounce verdict: the JSONL store record-bounce.js appends ────────────
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
      # awk appends the store path rather than sed embedding it: $f is a path
      # and contains '/', which is sed's own delimiter here.
      # `|| true`: a store with no matching lines makes grep exit 1, and under
      # `set -e` an assignment whose command substitution fails aborts the
      # whole script. That is not hypothetical - it silently turned an
      # APPROVED ancestor into a clean "no" the first time this was written.
      BOUNCE_TOKENS="$BOUNCE_TOKENS$(grep -oE '"commit":"[0-9a-fA-F]{7,40}"' "$f" \
                 | sed -E 's/"commit":"([0-9a-fA-F]+)"/\1/' \
                 | awk -v store="$f" '{print $0" "store}' || true)
"
    done
  fi

  # ── bounce verdict: tracked ticket-YAML bounce_history entries ──────────
  # The inline-map shape record-bounce writes:
  #   - { at: ..., by: <role>, ..., commit: <10-hex>, evidence: ... }
  # Matched with the by:/commit: pair on one line so ordinary prose that
  # happens to say "commit:" never false-positives.
  if [[ -d backlog ]]; then
    # Same prefix tolerance as the JSONL store: extract each entry's recorded
    # commit field and prefix-match it against the full sha.
    YAML_TOKENS="$(grep -rh -E 'by: [a-zA-Z]+.*commit: [0-9a-fA-F]{7,40}' backlog --include='*.yaml' 2>/dev/null \
                     | sed -E 's/.*commit: ([0-9a-fA-F]+).*/\1/' || true)"
  fi

  # ── approval: an expedite run's own QA-hat verdict (BL-1025) ────────────
  # BL-1086: a problem HERE is recorded rather than raised, because the
  # original order matters and is load-bearing - the expedite store was only
  # ever consulted AFTER the bounce stores had failed to veto, so a sha with a
  # bounce on file answers a clean "no" even when this store is unreadable.
  # Reading every store up front is what makes batching cheap; raising up front
  # would quietly change that verdict. answer_one raises it in the right place.
  EXPEDITE_DIR=".swarmforge/expedite-approvals"
  if [[ -e "$EXPEDITE_DIR" && ! -d "$EXPEDITE_DIR" ]]; then
    EXPEDITE_PROBLEM="is_qa_ancestor.sh: undeterminable - expedite verdict store $EXPEDITE_DIR exists but is not a directory (missing/obstructed record store)"
    return 0
  fi
  if [[ -d "$EXPEDITE_DIR" ]]; then
    for f in "$EXPEDITE_DIR"/*.jsonl; do
      [[ -e "$f" ]] || continue  # bash 3.2: unmatched glob stays literal
      if [[ ! -r "$f" ]]; then
        EXPEDITE_PROBLEM="is_qa_ancestor.sh: undeterminable - expedite verdict store $f is unreadable"
        return 0
      fi
      # Every non-empty line must carry BOTH fields the verdict is made of. A
      # line missing either is a corrupt record and the store cannot be
      # trusted either way - the same prefix tolerance on the commit field as
      # the bounce stores, for the same reason (recorders abbreviate).
      if grep -v -E '^\{.*"commit":"[0-9a-fA-F]{7,40}".*\}$' "$f" | grep -q -E '.'; then
        EXPEDITE_PROBLEM="is_qa_ancestor.sh: undeterminable - expedite verdict store $f holds a record line with no commit field"
        return 0
      fi
      if grep -v -E '^\{.*"approval":(true|false).*\}$' "$f" | grep -q -E '.'; then
        EXPEDITE_PROBLEM="is_qa_ancestor.sh: undeterminable - expedite verdict store $f holds a record line with no approval field"
        return 0
      fi
      # This side deliberately knows NOTHING about the verdict vocabulary.
      # `approval` is the already-classified decision expedite_lib.bb's own
      # `classify-verdict` computed, so `advance-verdicts` has exactly one
      # spelling in this codebase and a fourth token added to it needs no
      # second edit here. A hand-copied token list across this
      # Babashka/bash boundary - which no import can bridge - is the hazard
      # the Guardrails article names after BL-897. The record's `verdict`
      # string is for a human reading the store; nothing below reads it.
      # `|| true` for the same reason as the bounce store above: a store
      # holding only bouncing records matches nothing here, and an aborted
      # collection would answer the wrong thing rather than nothing.
      EXPEDITE_TOKENS="$EXPEDITE_TOKENS$(grep -E '"approval":true' "$f" \
                 | grep -oE '"commit":"[0-9a-fA-F]{7,40}"' \
                 | sed -E 's/"commit":"([0-9a-fA-F]+)"/\1/' \
                 | awk -v store="$f" '{print $0" "store}' || true)
"
    done
  fi

  # ── approval: the land step's replay->approved-source mapping (BL-1334) ──
  # The land step publishes a tip-pure replay to main and does NOT advance
  # swarmforge-QA, so QA's own approved work is not in the QA ref's ancestry
  # at the instant it lands. Rather than let a script write the ref that
  # DEFINES approval (which is what BL-952 says must not erode), the land
  # step records WHICH approved source each replay stands in for, and this
  # predicate resolves that mapping.
  #
  # The mapping is not a rubber stamp: a record grants approval only when the
  # SOURCE it names is itself approved, checked below in answer_one. A record
  # naming an unapproved source grants nothing, which is what keeps approval
  # from spreading to anything written into the store.
  LAND_DIR=".swarmforge/land-approvals"
  if [[ -e "$LAND_DIR" && ! -d "$LAND_DIR" ]]; then
    LAND_PROBLEM="is_qa_ancestor.sh: undeterminable - land-replay store $LAND_DIR exists but is not a directory (missing/obstructed record store)"
    return 0
  fi
  if [[ -d "$LAND_DIR" ]]; then
    for f in "$LAND_DIR"/*.jsonl; do
      [[ -e "$f" ]] || continue  # bash 3.2: unmatched glob stays literal
      if [[ ! -r "$f" ]]; then
        LAND_PROBLEM="is_qa_ancestor.sh: undeterminable - land-replay store $f is unreadable"
        return 0
      fi
      # BOTH fields are the verdict here: a record with no source names no
      # approved parcel and cannot be resolved, so a line missing either is a
      # corrupt record and the store cannot be trusted either way. Same
      # 7-40 prefix tolerance as every other store (recorders abbreviate).
      if grep -v -E '^\{.*"commit":"[0-9a-fA-F]{7,40}".*\}$' "$f" | grep -q -E '.'; then
        LAND_PROBLEM="is_qa_ancestor.sh: undeterminable - land-replay store $f holds a record line with no commit field"
        return 0
      fi
      if grep -v -E '^\{.*"source":"[0-9a-fA-F]{7,40}".*\}$' "$f" | grep -q -E '.'; then
        LAND_PROBLEM="is_qa_ancestor.sh: undeterminable - land-replay store $f holds a record line with no source field"
        return 0
      fi
      # "<replay-token> <source-token> <store>" per line.
      LAND_TOKENS="$LAND_TOKENS$(sed -E 's/.*"commit":"([0-9a-fA-F]+)".*"source":"([0-9a-fA-F]+)".*/\1 \2/' "$f" \
                 | awk -v store="$f" 'NF==2 {print $0" "store}' || true)
"
    done
  fi
}

# BL-1334: is the SOURCE a land record names itself approved? A mapping is
# only as good as what it points at. The source must resolve, carry no bounce
# verdict in either store, and be an ancestor of swarmforge-QA - which is the
# ordinary approval question, asked of the source rather than the replay.
# Deliberately NOT a recursive call into answer_one: a land record whose
# source is itself a replay would otherwise chain, and approval that can be
# reached through a chain of records is approval that spreads.
source_is_approved() {
  local source_token="$1" full_source token rc
  if ! full_source="$(git rev-parse --verify -q "${source_token}^{commit}" 2>/dev/null)"; then
    return 1
  fi
  while read -r token _rest; do
    [[ -n "$token" ]] || continue
    case "$full_source" in "$token"*) return 1 ;; esac
  done <<< "$BOUNCE_TOKENS"
  while read -r token; do
    [[ -n "$token" ]] || continue
    case "$full_source" in "$token"*) return 1 ;; esac
  done <<< "$YAML_TOKENS"
  rc=0
  git merge-base --is-ancestor "$full_source" swarmforge-QA || rc=$?
  return "$rc"
}

# One SHA's verdict against the already-collected stores. Echoes the same
# stderr lines a single run always did; returns the same 0/1/2 code a single
# run exits with.
answer_one() {
  local sha="$1"
  local token f rc

  # ── the sha itself must resolve (invariant 3: an unresolvable commit is an
  #    undeterminable verdict, never a clean "no") ────────────────────────
  if ! FULL_SHA="$(git rev-parse --verify -q "${sha}^{commit}" 2>/dev/null)"; then
    echo "is_qa_ancestor.sh: undeterminable - commit '$sha' does not resolve" >&2
    return 2
  fi
  SHORT_SHA="$(printf '%s' "$FULL_SHA" | cut -c1-10)"

  while read -r token f; do
    [[ -n "$token" ]] || continue
    match_bounce_token "$token" "has a QA bounce verdict on file ($f)" || return 1
  done <<< "$BOUNCE_TOKENS"

  while read -r token; do
    [[ -n "$token" ]] || continue
    match_bounce_token "$token" "appears in a ticket's bounce_history" || return 1
  done <<< "$YAML_TOKENS"

  # The bounce stores have had their say; only now does an unconsultable
  # expedite store make this sha undeterminable.
  if [[ -n "$EXPEDITE_PROBLEM" ]]; then
    echo "$EXPEDITE_PROBLEM" >&2
    return 2
  fi

  while read -r token f; do
    [[ -n "$token" ]] || continue
    case "$FULL_SHA" in
      "$token"*)
        echo "approved: $SHORT_SHA has an expedite QA-hat approval on file ($f, recorded as $token) - BL-1025" >&2
        return 0
        ;;
    esac
  done <<< "$EXPEDITE_TOKENS"

  # ── the land step's replay->approved-source mapping (BL-1334) ──────────
  if [[ -n "$LAND_PROBLEM" ]]; then
    echo "$LAND_PROBLEM" >&2
    return 2
  fi

  while read -r token source_token f; do
    [[ -n "$token" ]] || continue
    case "$FULL_SHA" in
      "$token"*)
        if source_is_approved "$source_token"; then
          echo "approved: $SHORT_SHA is a land-step replay of approved source $source_token ($f, recorded as $token) - BL-1334" >&2
          return 0
        fi
        # A record naming an unapproved source grants nothing. Said out loud
        # rather than falling silently through to ancestry, because a store
        # that looks like it should have approved this is exactly the thing a
        # reader will otherwise assume worked.
        echo "not approved: $SHORT_SHA has a land-replay record naming source $source_token, which is not itself approved ($f)" >&2
        ;;
    esac
  done <<< "$LAND_TOKENS"

  # ── ancestry (unchanged from BL-925): git's own exit code passes through -
  #    0 ancestor, 1 clean no, anything else a real failure callers must
  #    fail closed on ─────────────────────────────────────────────────────
  rc=0
  git merge-base --is-ancestor "$FULL_SHA" swarmforge-QA || rc=$?
  return "$rc"
}

collect_verdict_stores

if [[ "$BATCH_MODE" == "yes" ]]; then
  # Per-sha verdicts ride the printed lines, not this exit code: a
  # STORE-level problem already exited 2 inside collect_verdict_stores
  # above, and a per-sha 1/2 is a real answer, not a run failure.
  for sha in ${BATCH_SHAS[@]+"${BATCH_SHAS[@]}"}; do
    rc=0
    answer_one "$sha" || rc=$?
    printf '%s %s\n' "$sha" "$rc"
  done
  exit 0
fi

rc=0
answer_one "$SHA" || rc=$?
exit "$rc"
