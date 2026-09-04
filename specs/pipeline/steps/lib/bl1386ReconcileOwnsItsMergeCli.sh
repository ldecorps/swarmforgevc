#!/usr/bin/env bash
# BL-1386 acceptance fixture: drive the REAL absorb-with-merge! ladder over a
# REAL repository with a REAL diverged origin, through the same adapter shape
# handoffd.bb wires.
#
# Usage: bl1386ReconcileOwnsItsMergeCli.sh <work-dir> <shape>
#   shapes:
#     clean-abort        the real merge is refused after MERGE_HEAD is written,
#                        and the abort succeeds
#     abort-locked       the same, but .git/index.lock is held while the abort
#                        runs, so the abort fails
#     next-tick          tick 2 after abort-locked, with the lock released:
#                        the daemon must abort by OWNERSHIP
#     foreign-no-record  a MERGE_HEAD created outside the sweep, no record
#     foreign-other-sha  a MERGE_HEAD created outside the sweep, record naming
#                        a different sha
#     conflict           the real merge fails on a genuine content conflict
#
# Prints one JSON line:
#   {"mergeHeadPresent":bool,"recordSha":"...","recordedBeforeMerge":bool,
#    "ownedByRecord":bool,"logs":[["label","text"],...],"outcome":"..."}
#
# A real merge is made to FAIL the way the ticket's qa_e2e_procedure specifies:
# a pre-merge-commit hook that exits 1. That leaves MERGE_HEAD written and the
# merge unconcluded, which is exactly the live 2026-09-04 shape - and unlike a
# forced conflict it lets the `merge-failed` vs `conflict` distinction be
# observed rather than assumed.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/swarmforge/scripts/master_main_reconcile_lib.bb"

ORIGIN="$WORK/origin.git"
R="$WORK/repo"
DAEMON_DIR="$WORK/daemon"
mkdir -p "$DAEMON_DIR"

git init -q --bare -b main "$ORIGIN"
git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false
git -C "$R" remote add origin "$ORIGIN"
printf 'seed\n' >"$R/seed.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "seed"
git -C "$R" push -q origin main

# Diverge: origin gains a commit, local main gains a different one. No content
# conflict unless the shape asks for one.
CLONE="$WORK/clone"
git clone -q "$ORIGIN" "$CLONE"
git -C "$CLONE" config user.email t@t
git -C "$CLONE" config user.name t
git -C "$CLONE" config commit.gpgsign false
if [[ "$SHAPE" == "conflict" ]]; then
  printf 'origin-side\n' >"$CLONE/contested.txt"
else
  printf 'origin-side\n' >"$CLONE/origin-only.txt"
fi
git -C "$CLONE" add -A
git -C "$CLONE" commit -q -m "origin side"
git -C "$CLONE" push -q origin main

if [[ "$SHAPE" == "conflict" ]]; then
  printf 'local-side\n' >"$R/contested.txt"
else
  printf 'local-side\n' >"$R/local-only.txt"
fi
git -C "$R" add -A
git -C "$R" commit -q -m "local side"
git -C "$R" fetch -q origin

ORIGIN_SHA="$(git -C "$R" rev-parse origin/main)"

# The hook that makes a real merge fail AFTER MERGE_HEAD is written.
install_refusing_hook() {
  mkdir -p "$R/.git/hooks"
  cat >"$R/.git/hooks/pre-merge-commit" <<'HOOK'
#!/usr/bin/env bash
echo "pre-merge-commit hook refused this merge" >&2
exit 1
HOOK
  chmod +x "$R/.git/hooks/pre-merge-commit"
}

case "$SHAPE" in
  clean-abort|abort-locked|next-tick) install_refusing_hook ;;
  conflict) : ;;                       # a real content conflict, no hook
  foreign-no-record|foreign-other-sha)
    # A merge nobody recorded: started by hand, left open.
    install_refusing_hook
    git -C "$R" merge --no-edit origin/main >/dev/null 2>&1 || true
    rm -f "$R/.git/hooks/pre-merge-commit"
    if [[ "$SHAPE" == "foreign-other-sha" ]]; then
      printf '{"sha":"0000000000000000000000000000000000000000"}\n' \
        >"$DAEMON_DIR/master-main-merge-owner.json"
    fi
    ;;
esac

export BL1386_LIB="$LIB" BL1386_REPO="$R" BL1386_DAEMON="$DAEMON_DIR"
export BL1386_SHAPE="$SHAPE" BL1386_ORIGIN_SHA="$ORIGIN_SHA"

bb -e "$(cat <<'BB'
(require '[clojure.string :as str] '[cheshire.core :as json] '[babashka.process :as p])
(load-file (System/getenv "BL1386_LIB"))

(def repo (System/getenv "BL1386_REPO"))
(def daemon-dir (System/getenv "BL1386_DAEMON"))
(def shape (System/getenv "BL1386_SHAPE"))
(def logs (atom []))
(def recorded-before-merge (atom false))
(def merge-ran (atom false))

(defn- git [& args]
  (let [r (p/sh (into ["git"] args) {:dir repo})]
    {:exit (:exit r) :out (str (:out r)) :err (str (:err r))}))

(defn- merge-head-sha []
  (let [{:keys [exit out]} (git "rev-parse" "-q" "--verify" "MERGE_HEAD")]
    (when (zero? exit) (str/trim out))))

;; The adapter set handoffd.bb wires, reproduced here so the acceptance drives
;; the REAL ladder rather than a restatement of it.
(def adapters
  {:ff! (fn [] {:success (zero? (:exit (git "merge" "--ff-only" "--no-edit" "origin/main")))})
   :merge! (fn []
             (reset! merge-ran true)
             (let [{:keys [exit out err]} (git "merge" "--no-edit" "origin/main")
                   text (str out "\n" err)]
               {:success (zero? exit)
                :error (str/trim text)
                :conflict? (boolean (or (str/includes? text "CONFLICT")
                                        (str/includes? text "Automatic merge failed")))}))
   :abort! (fn []
             (if (= shape "abort-locked")
               ;; Hold the index lock exactly while the abort runs.
               (do (spit (str repo "/.git/index.lock") "")
                   (let [{:keys [exit err]} (git "merge" "--abort")]
                     (.delete (java.io.File. (str repo "/.git/index.lock")))
                     (if (zero? exit)
                       {:success true}
                       {:success false :error (str/trim err)})))
               (let [{:keys [exit err]} (git "merge" "--abort")]
                 (if (zero? exit) {:success true} {:success false :error (str/trim err)}))))
   :fallback! (fn [] (swap! logs conj ["fallback" ""]) {:success true :outcome :rematched})
   :record-owner! (fn []
                    (reset! recorded-before-merge (not @merge-ran))
                    (master-main-reconcile-lib/write-merge-owner!
                     daemon-dir {:sha (System/getenv "BL1386_ORIGIN_SHA")}))
   :clear-owner! (fn [] (master-main-reconcile-lib/clear-merge-owner! daemon-dir))
   :log! (fn [label text] (swap! logs conj [label text]))})

;; next-tick: tick 1 leaves an owned MERGE_HEAD open (its abort was defeated
;; by the lock), then the lock is released and tick 2 must finish it BY
;; OWNERSHIP rather than surfacing human-merge-in-progress.
;;
;; ARCHITECT BOUNCE D1b (2026-09-04): this function used to compute `owned?`
;; itself and then call `git merge --abort` and `clear-merge-owner!` itself -
;; it re-implemented the very behaviour under test, so it passed while the
;; daemon did not do it at all. The DECISION now comes from production code:
;; `classify-open-merge` then `automated-absorb-plan`, the same two functions
;; handoffd.bb's dispatch calls. The fixture performs only what the daemon's
;; adapters perform, and only when production says to.
(defn- run-next-tick []
  ;; Tick 1, with the lock held during the abort.
  (let [tick1 (master-main-reconcile-lib/absorb-with-merge!
               (assoc adapters
                      :abort! (fn []
                                (spit (str repo "/.git/index.lock") "")
                                (let [{:keys [exit err]} (git "merge" "--abort")]
                                  (.delete (java.io.File. (str repo "/.git/index.lock")))
                                  (if (zero? exit) {:success true} {:success false :error (str/trim err)})))))
        mh (merge-head-sha)
        record (master-main-reconcile-lib/read-merge-owner daemon-dir)
        ;; PRODUCTION classification, not a fixture opinion.
        klass (master-main-reconcile-lib/classify-open-merge
               {:merge-head-present? (some? mh)
                :owned-by-daemon? (master-main-reconcile-lib/owns-merge-head? record mh)
                :live-git-process? false
                :lock-fresh? false})
        ;; PRODUCTION dispatch, the same call handoffd.bb makes.
        branch (master-main-reconcile-lib/automated-absorb-plan
                {:merge-head-present? (some? mh) :merge-class klass :behind 3})]
    (swap! logs conj ["tick1-outcome" (str (:outcome tick1))])
    (swap! logs conj ["tick2-branch" (str branch)])
    (if (= branch :abort-owned-merge)
      ;; What the daemon's adapters do on that branch, and nothing more: the
      ;; gate above is production's, so a regression that stops routing here
      ;; makes this scenario fail rather than silently pass.
      (if (master-main-reconcile-lib/may-abort-failed-merge?
           false {:owner-record record :merge-head-sha mh})
        (let [{:keys [exit err]} (git "merge" "--abort")]
          (if (zero? exit)
            (do (master-main-reconcile-lib/clear-merge-owner! daemon-dir)
                (swap! logs conj ["aborted-by-ownership" ""])
                {:outcome "aborted-by-ownership"})
            (do (swap! logs conj ["merge-abort-failed" (str/trim err)])
                {:outcome "merge-abort-failed"})))
        (do (swap! logs conj ["ownership-evaporated" ""])
            {:outcome "human-merge-in-progress"}))
      (do (swap! logs conj ["skip-human-merge-in-progress" ""])
          {:outcome (str branch)}))))

;; A foreign MERGE_HEAD is decided BEFORE any merge is attempted, exactly as
;; the daemon's own plan does - the sweep never reaches the ladder for one.
(def result
  (if (= shape "next-tick")
    (run-next-tick)
    (if (str/starts-with? shape "foreign")
    (let [mh (merge-head-sha)
          record (master-main-reconcile-lib/read-merge-owner daemon-dir)]
      {:outcome (if (master-main-reconcile-lib/may-abort-failed-merge?
                     false {:owner-record record :merge-head-sha mh})
                  "would-abort"
                  "skip-human-merge-in-progress")})
      (master-main-reconcile-lib/absorb-with-merge! adapters))))

(let [mh (merge-head-sha)
      record (master-main-reconcile-lib/read-merge-owner daemon-dir)]
  (println (json/generate-string
            {:mergeHeadPresent (boolean mh)
             :recordSha (str (:sha record))
             :recordedBeforeMerge @recorded-before-merge
             :ownedByRecord (master-main-reconcile-lib/owns-merge-head? record mh)
             :logs @logs
             :outcome (str (:outcome result))})))
BB
)"
