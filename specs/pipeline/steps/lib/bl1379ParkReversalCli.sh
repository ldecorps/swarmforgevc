#!/usr/bin/env bash
# BL-1379 acceptance fixture: drive the REAL park reversal over a REAL git
# repository with a REAL backlog and a REAL ancestor check.
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
# A real repo and a real `git merge-base --is-ancestor`: invariant 2 is about
# whether the expedition LANDED, and a fixture that fakes that check cannot
# exhibit the thing it guards.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/swarmforge/scripts/expedite_lib.bb"

R="$WORK/repo"
mkdir -p "$R/backlog/active" "$R/backlog/hold" "$R/backlog/paused" "$R/backlog/done"
mkdir -p "$R/.swarmforge/expedite/BL-9001"

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
  moved)  git -C "$R" add -A >/dev/null; mv "$R/backlog/hold/BL-9002-fixture.yaml" "$R/backlog/active/" ;;
  closed) mv "$R/backlog/hold/BL-9002-fixture.yaml" "$R/backlog/done/" ;;
esac

git -C "$R" add -A
git -C "$R" commit -q -m "fixture backlog"
BASE="$(git -C "$R" rev-parse HEAD)"

# The expedition's commit. For `landed` it is on main; otherwise it is on a
# side branch main cannot see - a REAL ancestry difference, not a flag.
if [[ "$SHAPE" == "not-landed" ]]; then
  git -C "$R" checkout -q -b expedite/BL-9001
  git -C "$R" commit -q --allow-empty -m "BL-9001: expedition work"
  EXPEDITION="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q main
else
  git -C "$R" commit -q --allow-empty -m "BL-9001: expedition work"
  EXPEDITION="$(git -C "$R" rev-parse HEAD)"
fi

# The run's own park record - only BL-9002. BL-9003 is deliberately absent:
# invariant 1 is that the reversal cannot even see a ticket it did not park.
cat >"$R/.swarmforge/expedite/BL-9001/park-record.json" <<REC
{"run-ticket":"BL-9001","destination":"hold","at":"fixture",
 "parked":[{"ticket":"BL-9002","from":"active"}]}
REC

export BL1379_LIB="$LIB" BL1379_REPO="$R" BL1379_COMMIT="$EXPEDITION" BL1379_SHAPE="$SHAPE"

bb -e "$(cat <<'BB'
(require '[clojure.string :as str] '[cheshire.core :as json]
         '[babashka.process :as p] '[babashka.fs :as fs])
(load-file (System/getenv "BL1379_LIB"))
;; The REAL promotion gate, so scenario 09's "the promotion helper skips it as
;; blocked" is answered by production rather than by restating its rule here.
(load-file (str (fs/path (fs/parent (System/getenv "BL1379_LIB")) "promotion_gates_lib.bb")))

(def repo (System/getenv "BL1379_REPO"))
(def commit (System/getenv "BL1379_COMMIT"))
(def shape (System/getenv "BL1379_SHAPE"))

(defn- folder-of [ticket]
  (some (fn [sub]
          (when (seq (filter #(str/starts-with? (fs/file-name %) (str ticket "-"))
                             (fs/list-dir (fs/path repo "backlog" sub))))
            sub))
        ["hold" "active" "paused" "done"]))

(defn- landed? []
  (zero? (:exit (p/sh ["git" "merge-base" "--is-ancestor" commit "main"] {:dir repo}))))

(def record (json/parse-string (slurp (str repo "/.swarmforge/expedite/BL-9001/park-record.json")) true))

;; The REAL reversal: production's plan, and only the moves it authorises.
(defn- run-reversal []
  (let [plan (expedite-lib/unpark-plan {:record record :landed? (landed?)
                                        :current-folder-of folder-of})]
    (doseq [{:keys [ticket from]} (:restore plan)]
      (let [src (first (filter #(str/starts-with? (fs/file-name %) (str ticket "-"))
                               (fs/list-dir (fs/path repo "backlog" "hold"))))]
        (when src
          (fs/move src (fs/path repo "backlog" from (fs/file-name src)))
          ;; The human's ruling (option 3), per backlog-schema.md: status
          ;; blocked (what the promotion helper actually reads), the field
          ;; saying why, and the reason naming the expedition.
          (let [dst (str (fs/path repo "backlog" from (fs/file-name src)))
                mark (expedite-lib/freshness-mark {:run-ticket (:run-ticket record)})]
            (spit dst (str (str/replace (slurp dst) #"(?m)^status:.*$"
                                        (str "status: " (:status mark)))
                           expedite-lib/freshness-mark-field ": "
                           (get mark expedite-lib/freshness-mark-field) "\n"
                           expedite-lib/freshness-reason-field ": "
                           (get mark expedite-lib/freshness-reason-field) "\n"))))))
    (expedite-lib/unpark-report plan)))

(def report (run-reversal))
(def report2 (when (= shape "twice") (run-reversal)))
(def final-report (or report2 report))

(defn- ids-in [sub]
  (vec (sort (map #(first (str/split (fs/file-name %) #"-fixture"))
                  (fs/list-dir (fs/path repo "backlog" sub))))))

(def restored-file
  (when-let [f (first (filter #(str/starts-with? (fs/file-name %) "BL-9002-")
                              (mapcat #(fs/list-dir (fs/path repo "backlog" %))
                                      ["active" "paused" "hold" "done"])))]
    (slurp (str f))))

(println (json/generate-string
          {:restored (:restored final-report)
           :left (:left final-report)
           :note (:note final-report)
           :holdAfter (ids-in "hold")
           :activeAfter (ids-in "active")
           :pausedAfter (ids-in "paused")
           :doneAfter (ids-in "done")
           :marked (boolean (and restored-file
                                 (str/includes? restored-file
                                                expedite-lib/freshness-mark-field)))
           :restoredStatus (when restored-file
                             (second (re-find #"(?m)^status:\s*(\S+)" restored-file)))
           :markNamesRun (boolean (and restored-file
                                       (str/includes? restored-file (:run-ticket record))))
           ;; The REAL promotion gate's verdict on the restored ticket - the
           ;; half of the mark that actually stops it being worked.
           :promotionBlocked (boolean
                              (when restored-file
                                (promotion-gates-lib/blocked-status-refusal restored-file)))
           :restoredAndMarked (:restored-and-marked final-report)}))
BB
)"
