#!/usr/bin/env bash
# BL-1428: refuses a commit that ADDS or CHANGES a standing-red register or
# ledger row naming a ticket that is not open (backlog/paused or
# backlog/active) - a closed or absent ticket refuses, naming the row.
#
# Judges only the row(s) THIS commit adds or changes (invariant 2): a row
# already on HEAD that has since gone stale is the throttle's signal
# (BL-1429), never the committer's fault, and never refuses a commit that
# does not touch it. `git diff --cached -U0` on each of the three source
# paths gives exactly the resulting (post-change) lines with none of the
# surrounding context a wider diff would also report as "changed".
#
# Sources judged:
#   backlog/standing-reds.tsv                                (lane file ticket first_seen note)
#   swarmforge/scripts/property_suite_standing_allowlist.tsv (file disposition rationale - no
#     ticket column of its own; an added/changed allowlist row is judged by
#     whether the CURRENT staged register already names an open ticket for
#     it, via the SAME join standing_red_register_lib.bb's build-report
#     uses - never a second, independent ownership rule)
#   backlog/hardening-debt-ledger.yaml                        (a new/changed `- parcel: X` line)
#
# Fail-open on an unreadable git index (WARN, exit 0) - the chain's posture
# elsewhere (check_ticket_deletion.sh et al.): a check that cannot run is
# never mistaken for a check that passed, but this guard's OWN refusal
# requires being SURE, not merely suspicious.
#
# Usage: check_standing_red_register.sh [commit-message-file]
#   The message-file argument is accepted for interface parity with the
#   other pre-commit guards but unused - openness never depends on commit
#   message text.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "check_standing_red_register: WARNING - could not resolve the repo root; skipping." >&2
  exit 0
fi
cd "$REPO_ROOT" || { echo "check_standing_red_register: WARNING - could not cd to $REPO_ROOT; skipping." >&2; exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REGISTER_PATH="backlog/standing-reds.tsv"
ALLOWLIST_PATH="swarmforge/scripts/property_suite_standing_allowlist.tsv"
LEDGER_PATH="backlog/hardening-debt-ledger.yaml"

# A single ticket-id's openness. NOT a load-file of
# standing_red_register_cli.bb: that is a `*_cli.bb` entry script that runs
# its own -main as a load-time side effect (BL-1431's own load-safety
# lesson - never load-file one of those directly). This is instead a small,
# self-contained `bb -e` mirroring real-ticket-state's own paused/active
# glob rule exactly (the register CLI's :closed distinction does not
# matter here - :closed and :absent both refuse identically).
ticket_open() {
  local ticket="$1"
  bb -e "
(require '[babashka.fs :as fs])
(defn glob-first [dir pattern]
  (when (fs/exists? dir) (first (fs/glob dir pattern))))
(let [root \".\"
      t \"$ticket\"]
  (cond
    (glob-first (fs/path root \"backlog\" \"paused\") (str t \"*.yaml\")) (System/exit 0)
    (glob-first (fs/path root \"backlog\" \"active\") (str t \"*.yaml\")) (System/exit 0)
    :else (System/exit 1)))
" 2>/dev/null
}

# Every `+` content line from `git diff --cached -U0 -- <path>`, excluding
# the `+++ b/<path>` file-header line diff itself always emits first.
added_or_changed_lines() {
  local path="$1"
  git diff --cached -U0 -- "$path" 2>/dev/null | grep -E '^\+[^+]' | sed -E 's/^\+//'
}

violations=()

# `read` with IFS set to TAB still collapses two consecutive delimiters
# into one and drops a leading/trailing empty field - tab is an "IFS
# whitespace" character to bash's own read builtin regardless of which
# whitespace character(s) IFS names, and a row with a genuinely EMPTY
# ticket column (exactly the case that must refuse) would silently shift
# every field after it one column left. Measured live authoring this
# guard. awk's -F'\t' has no such behaviour; re-joining on a byte no field
# here ever contains (\x01) before handing lines to `read` sidesteps it
# entirely, rather than trusting `read` with a tab IFS a second time.
tsv_fields_01() {
  awk -F'\t' -v OFS=$'\x01' '{ $1 = $1; print }'
}

# ── the register itself: ticket is column 3, straightforward ────────────
while IFS=$'\x01' read -r lane file ticket _rest; do
  [[ -n "${lane:-}" ]] || continue
  # A comment or blank line never reaches here (diff only ever shows real
  # content lines added), but guard anyway - the register's own convention.
  [[ "$lane" == \#* ]] && continue
  if [[ -z "${ticket:-}" ]]; then
    violations+=("backlog/standing-reds.tsv row for $file names no ticket at all")
    continue
  fi
  if ! ticket_open "$ticket"; then
    violations+=("backlog/standing-reds.tsv row for $file names $ticket, which is not open (closed or absent)")
  fi
done < <(added_or_changed_lines "$REGISTER_PATH" | tsv_fields_01)

# ── the ledger: a new/changed debt row's own `- parcel: X` line ─────────
while IFS= read -r line; do
  [[ "$line" == "- parcel:"* ]] || continue
  raw="${line#"- parcel:"}"
  raw="$(echo "$raw" | sed -E 's/^[[:space:]]*"?//; s/"?[[:space:]]*$//')"
  ticket="$(printf '%s' "$raw" | grep -oE '^[A-Za-z]+-[0-9]+' || true)"
  if [[ -z "$ticket" ]]; then
    violations+=("backlog/hardening-debt-ledger.yaml row for parcel '$raw' names no ticket id")
    continue
  fi
  if ! ticket_open "$ticket"; then
    violations+=("backlog/hardening-debt-ledger.yaml row for parcel '$raw' names $ticket, which is not open (closed or absent)")
  fi
done < <(added_or_changed_lines "$LEDGER_PATH")

# ── the allowlist: no ticket column of its own - judged by the CURRENT
#    staged register's own join (the same rule standing_red_register_lib.bb
#    uses), never a second ownership rule invented here. ────────────────
allowlist_added_files=()
while IFS=$'\x01' read -r file disposition _rest; do
  [[ -n "${file:-}" ]] || continue
  [[ "$disposition" == "allowlist" ]] || continue
  allowlist_added_files+=("$file")
done < <(added_or_changed_lines "$ALLOWLIST_PATH" | tsv_fields_01)

if (( ${#allowlist_added_files[@]} > 0 )); then
  staged_register="$(git show ":$REGISTER_PATH" 2>/dev/null || true)"
  for file in "${allowlist_added_files[@]}"; do
    normalized="$file"
    [[ "$normalized" == extension/* ]] || normalized="extension/$normalized"
    row="$(printf '%s\n' "$staged_register" | awk -F'\t' -v f="$normalized" '$1=="property" && $2==f {print; exit}')"
    if [[ -z "$row" ]]; then
      violations+=("$ALLOWLIST_PATH row for $file has no matching backlog/standing-reds.tsv property row naming its ticket")
      continue
    fi
    ticket="$(printf '%s' "$row" | awk -F'\t' '{print $3}')"
    if [[ -z "$ticket" ]] || ! ticket_open "$ticket"; then
      violations+=("$ALLOWLIST_PATH row for $file is registered under ${ticket:-no ticket}, which is not open (closed or absent)")
    fi
  done
fi

if (( ${#violations[@]} > 0 )); then
  echo "check_standing_red_register: COMMIT REFUSED - a standing-red row this commit adds or changes names a ticket that is not open:" >&2
  for v in "${violations[@]}"; do
    echo "  - $v" >&2
  done
  exit 1
fi

exit 0
