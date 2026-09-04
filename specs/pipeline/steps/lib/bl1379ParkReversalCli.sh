#!/usr/bin/env bash
# BL-1379 acceptance fixture: drive the REAL park reversal, through its REAL
# production entry point, over a REAL git repository with a REAL backlog and a
# REAL `git merge-base --is-ancestor` check.
#
# Usage: bl1379ParkReversalCli.sh <work-dir> <shape>
#   shapes:
#     landed              the expedition's commit IS an ancestor of main
#     not-landed          it is NOT
#     human-held          a ticket a HUMAN put in hold/, alongside the parked one
#     twice               the reversal runs twice
#     moved               the parked ticket was moved to active/ by hand
#     closed              the parked ticket was closed into done/
#
# Prints one JSON line:
#   {"restored":[...],"left":[...],"holdAfter":[...],"activeAfter":[...],
#    "pausedAfter":[...],"doneAfter":[...],"marked":bool,"note":"..."}
#
# What is under test is `expedite_cli.bb unpark <root> <run-dir>` — the same
# subcommand handoffd's expedite-park-reversal sweep invokes, not the pure plan
# beneath it. The architect bounced the first version of this ticket for
# exactly that gap: the reversal was fully built, the acceptance suite drove
# the library directly, and so nothing noticed that no production caller
# existed. A fixture that reimplements the wiring cannot see the wiring
# missing.
#
# A real repo and a real ancestor check likewise: invariant 2 is about whether
# the expedition LANDED, and a fixture that fakes that check cannot exhibit the
# thing it guards.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"
LIB="$SCRIPTS/expedite_lib.bb"
CLI="$SCRIPTS/expedite_cli.bb"

R="$WORK/repo"
RUN_DIR="$R/.swarmforge/expedite/BL-9001"
mkdir -p "$R/backlog/active" "$R/backlog/hold" "$R/backlog/paused" "$R/backlog/done" "$RUN_DIR"

git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false

mk_ticket() { # <folder> <id>
  printf 'id: %s\nstatus: todo\nhuman_approval: approved\n' "$2" \
    >"$R/backlog/$1/$2-fixture.yaml"
}

# The parked ticket: parked OUT OF active/, currently sitting in hold/.
mk_ticket hold BL-9002
# A human's own held ticket, present in every shape so invariant 1 is always
# under test, not only in the scenario named for it.
mk_ticket hold BL-9003

case "$SHAPE" in
  moved)  mv "$R/backlog/hold/BL-9002-fixture.yaml" "$R/backlog/active/" ;;
  closed) mv "$R/backlog/hold/BL-9002-fixture.yaml" "$R/backlog/done/" ;;
esac

git -C "$R" add -A
git -C "$R" commit -q -m "fixture backlog"

# The expedition's commit, on the branch the reversal resolves it from. For
# `landed` the branch tip is on main; otherwise it is on a side branch main
# cannot see — a REAL ancestry difference, not a flag.
if [[ "$SHAPE" == "not-landed" ]]; then
  git -C "$R" checkout -q -b expedite/BL-9001
  git -C "$R" commit -q --allow-empty -m "BL-9001: expedition work"
  git -C "$R" checkout -q main
else
  git -C "$R" commit -q --allow-empty -m "BL-9001: expedition work"
  git -C "$R" branch expedite/BL-9001
fi

# The run's own park record, written through production's OWN park-record
# shape — only BL-9002. BL-9003 is deliberately absent: invariant 1 is that the
# reversal cannot even see a ticket it did not park.
BL1379_LIB="$LIB" BL1379_OUT="$RUN_DIR/park-record.json" bb -e '
(require (quote [cheshire.core :as json]))
(load-file (System/getenv "BL1379_LIB"))
(spit (System/getenv "BL1379_OUT")
      (json/generate-string
       (expedite-lib/park-record {:run-ticket "BL-9001"
                                  :parked-tickets ["BL-9002"]
                                  :origin-folder "active"
                                  :at "fixture"})))' >/dev/null

run_reversal() { bb "$CLI" unpark "$R" "$RUN_DIR" 2>&1; }

OUT="$(run_reversal)"
if [[ "$SHAPE" == "twice" ]]; then OUT="$(run_reversal)"; fi

REPORT="$(printf '%s\n' "$OUT" | grep '^UNPARK_REPORT ' | tail -1 | cut -d' ' -f2-)"
if [[ -z "$REPORT" ]]; then
  echo "no UNPARK_REPORT line from the production entry point; output was:" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi

BL1379_LIB="$LIB" BL1379_REPO="$R" BL1379_REPORT="$REPORT" bb -e '
(require (quote [clojure.string :as str]) (quote [cheshire.core :as json])
         (quote [babashka.fs :as fs]))
(load-file (System/getenv "BL1379_LIB"))
;; The REAL promotion gate, so scenario 09s "the promotion helper skips it as
;; blocked" is answered by production rather than by restating its rule here.
(load-file (str (fs/path (fs/parent (System/getenv "BL1379_LIB")) "promotion_gates_lib.bb")))

(def repo (System/getenv "BL1379_REPO"))
(def report (json/parse-string (System/getenv "BL1379_REPORT") true))

(defn- ids-in [sub]
  (vec (sort (map #(first (str/split (fs/file-name %) #"-fixture"))
                  (fs/list-dir (fs/path repo "backlog" sub))))))

(def restored-file
  (when-let [f (first (filter #(str/starts-with? (fs/file-name %) "BL-9002-")
                              (mapcat #(fs/list-dir (fs/path repo "backlog" %))
                                      ["active" "paused" "hold" "done"])))]
    (slurp (str f))))

(println (json/generate-string
          {:restored (:restored report)
           :left (:left report)
           :note (:note report)
           :holdAfter (ids-in "hold")
           :activeAfter (ids-in "active")
           :pausedAfter (ids-in "paused")
           :doneAfter (ids-in "done")
           :marked (boolean (and restored-file
                                 (str/includes? restored-file
                                                expedite-lib/freshness-mark-field)))
           :restoredStatus (when restored-file
                             (second (re-find #"(?m)^status:\s*(\S+)" restored-file)))
           ;; The mark must name the EXPEDITION that parked the ticket, not the
           ;; ticket it is written on — the two were conflated by a shadowed
           ;; binding in the first implementation.
           :markNamesRun (boolean (and restored-file
                                       (str/includes? restored-file "BL-9001")))
           :promotionBlocked (boolean
                              (when restored-file
                                (promotion-gates-lib/blocked-status-refusal restored-file)))
           :restoredAndMarked (:restored-and-marked report)}))'
