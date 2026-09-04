#!/usr/bin/env bash
# BL-1387 acceptance fixture: a REAL open MERGE_HEAD on a REAL repository,
# classified through the REAL lib with the REAL daemon inputs.
#
# Usage: bl1387OrphanedMergeCli.sh <work-dir> <shape>
#   shapes:
#     orphan-poisoned   open merge, no owner, index carries NONE of HEAD..MERGE_HEAD
#     orphan-carrying   open merge, no owner, index DOES carry an incoming path
#     fresh-lock        open merge, .git/index.lock touched now
#     stale-lock        open merge, .git/index.lock aged past the window
#     owned             open merge, a BL-1386 ownership record naming its sha
#     live-process      open merge, a live git process signal
#
# Prints one JSON line:
#   {"class":"...","reason":"...","surface":"...","escalation":"...",
#    "mergeHeadBefore":"...","mergeHeadAfter":"...","indexBefore":"...",
#    "indexAfter":"...","unmergedPaths":N,"carriesIncoming":bool|null}
#
# MERGE_HEAD, the index, and the lock file are all REAL: the index-poisoning
# reading is the whole of invariant 3 and a stubbed index could not exhibit
# it. The live-git-process signal is the one injected input - spawning a real
# long-lived `git merge` parked on its editor is the environmentally
# unsuitable boundary (shared Design And Testability), and the daemon adapter
# that reads /proc/<pid>/cwd is exercised there, not here.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/swarmforge/scripts/master_main_reconcile_lib.bb"

R="$WORK/repo"
DAEMON_DIR="$WORK/daemon"
mkdir -p "$DAEMON_DIR"

git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false
printf 'seed\n' >"$R/seed.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "seed"

# A side branch whose content is the "incoming" side of the open merge.
git -C "$R" checkout -q -b incoming
printf 'incoming\n' >"$R/incoming.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "incoming side"
INCOMING_SHA="$(git -C "$R" rev-parse HEAD)"
git -C "$R" checkout -q main
printf 'local\n' >"$R/local.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "local side"

# An open merge created OUTSIDE the sweep: MERGE_HEAD written by hand, exactly
# the residue a killed pane or a failed abort leaves behind.
printf '%s\n' "$INCOMING_SHA" >"$R/.git/MERGE_HEAD"

case "$SHAPE" in
  orphan-carrying)
    # The index genuinely carries an incoming path.
    git -C "$R" checkout -q "$INCOMING_SHA" -- incoming.txt
    ;;
  orphan-poisoned)
    # The 2026-09-04 shape: something staged, but NONE of the incoming side.
    printf 'stray\n' >"$R/stray.txt"
    git -C "$R" add stray.txt
    ;;
  fresh-lock) : >"$R/.git/index.lock" ;;
  stale-lock)
    : >"$R/.git/index.lock"
    touch -d '2 hours ago' "$R/.git/index.lock" 2>/dev/null \
      || touch -A -020000 "$R/.git/index.lock" 2>/dev/null || true
    ;;
  owned)
    printf '{"sha":"%s"}\n' "$INCOMING_SHA" >"$DAEMON_DIR/master-main-merge-owner.json"
    ;;
  live-process) : ;;
esac

export BL1387_LIB="$LIB" BL1387_REPO="$R" BL1387_DAEMON="$DAEMON_DIR" BL1387_SHAPE="$SHAPE"

bb -e "$(cat <<'BB'
(require '[clojure.string :as str] '[cheshire.core :as json]
         '[babashka.process :as p] '[babashka.fs :as fs])
(load-file (System/getenv "BL1387_LIB"))

(def repo (System/getenv "BL1387_REPO"))
(def daemon-dir (System/getenv "BL1387_DAEMON"))
(def shape (System/getenv "BL1387_SHAPE"))

(defn- git [& args]
  (let [r (p/sh (into ["git"] args) {:dir repo})]
    {:exit (:exit r) :out (str (:out r))}))

(defn- paths [& args]
  (let [{:keys [exit out]} (apply git args)]
    (when (zero? exit) (remove str/blank? (str/split-lines (str/trim out))))))

(defn- merge-head []
  (let [{:keys [exit out]} (git "rev-parse" "-q" "--verify" "MERGE_HEAD")]
    (when (zero? exit) (str/trim out))))

(defn- index-digest []
  (str/trim (:out (git "diff" "--cached" "--name-status" "HEAD"))))

(def mh-before (merge-head))
(def index-before (index-digest))

;; The lock's REAL mtime against a real clock - the freshness window is the
;; thing under test, so neither side is faked.
(def lock-path (fs/path repo ".git" "index.lock"))
(def lock-state
  (if (fs/exists? lock-path)
    {:lock-present? true
     :lock-mtime-ms (.toMillis (fs/last-modified-time lock-path))
     :now-ms (System/currentTimeMillis)}
    {:lock-present? false :now-ms (System/currentTimeMillis)}))

(def klass
  (master-main-reconcile-lib/classify-open-merge
   {:merge-head-present? (some? mh-before)
    :owned-by-daemon? (master-main-reconcile-lib/owns-merge-head?
                       (master-main-reconcile-lib/read-merge-owner daemon-dir) mh-before)
    :live-git-process? (= shape "live-process")
    :lock-fresh? (master-main-reconcile-lib/index-lock-fresh? lock-state)}))

(def carries
  (master-main-reconcile-lib/index-carries-incoming?
   (paths "diff" "--cached" "--name-only" "HEAD")
   (paths "diff" "--name-only" "HEAD" "MERGE_HEAD")))

(def branch
  (master-main-reconcile-lib/automated-absorb-plan
   {:merge-head-present? (some? mh-before) :merge-class klass :behind 3}))

;; The reason is derived from the BRANCH production actually returned, with no
;; else-branch to fall into. An earlier version mapped anything that was not
;; :skip-orphaned-merge to "human-merge-in-progress", which silently absorbed
;; BL-1386's new :abort-owned-merge and reported a reading that no longer
;; happens - the same masking shape the BL-1386 D1 bounce was about.
(def reason (case branch
              :skip-orphaned-merge "orphaned-merge"
              :skip-human-merge-in-progress "human-merge-in-progress"
              :abort-owned-merge "aborted-owned-merge"
              (str "unmapped-branch:" branch)))

;; Unmerged-path COUNT, reported so the acceptance can show the poisoned index
;; has none and still is not safe - the reading invariant 3 forbids relying on.
(def unmerged (count (or (paths "diff" "--name-only" "--diff-filter=U") [])))

(println (json/generate-string
          {:class (name klass)
           :reason reason
           :surface (if (= reason "orphaned-merge")
                      (master-main-reconcile-lib/surface-message
                       {:reason :orphaned-merge :behind 3
                        :merge-head-sha mh-before :carries-incoming? carries})
                      (master-main-reconcile-lib/surface-message
                       {:reason :human-merge-in-progress :behind 3}))
           :escalation (when (= reason "orphaned-merge")
                         (master-main-reconcile-lib/orphaned-merge-escalation
                          {:merge-head-sha mh-before :carries-incoming? carries}))
           :mergeHeadBefore (str mh-before)
           :mergeHeadAfter (str (merge-head))
           :indexBefore index-before
           :indexAfter (index-digest)
           :unmergedPaths unmerged
           :carriesIncoming carries}))
BB
)"
