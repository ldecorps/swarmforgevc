#!/usr/bin/env bb
;; BL-1236 acceptance driver: reproduces handoffd.bb's master-main-reconcile
;; entry point (verdict -> master_main_reconcile_lib.bb's absorb-dispatch-
;; plan -> execution) against a REAL git repo, with REAL git for every step
;; except the merge verdict itself, which may be forced for scenario 03
;; ("git cannot produce a merge verdict") - genuinely forcing `git
;; merge-tree --write-tree` to fail (as opposed to reporting clean/conflict)
;; is not portably reproducible from a scripted fixture, so this is the same
;; kind of deliberate, documented test-only lever the project's other CLI
;; drivers already use for the one input a real git process can't be made
;; to misbehave on cue (e.g. bl1198RematchPushFirstCli.bb's push! stub).
;; Every other input (ahead/behind, tip-contains-origin?, merge-head-
;; present?, and the actual git commands the plan executes) is real.
;;
;; Usage: bb bl1236ReconcileSweepCli.bb <repo-root> [--force-verdict=clean|conflict|unavailable]
;; Prints one JSON line:
;;   {"verdict":str,"plan":str,"outcome":str,
;;    "resetPerformed":bool,"mergeAttempted":bool,
;;    "headBefore":str,"headAfter":str}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(def force-verdict-arg
  (some #(when (str/starts-with? % "--force-verdict=") (subs % (count "--force-verdict=")))
        (rest *command-line-args*)))

(when-not root
  (binding [*out* *err*] (println "usage: bl1236ReconcileSweepCli.bb <repo-root> [--force-verdict=clean|conflict|unavailable]"))
  (System/exit 2))

(defn sh [& args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(sh "git" "fetch" "origin" "main")

(def head-before (:out (sh "git" "rev-parse" "HEAD")))

(defn rev-counts! []
  (let [r (sh "git" "rev-list" "--left-right" "--count" "origin/main...main")
        [behind ahead] (map parse-long (str/split (:out r) #"\s+"))]
    {:ahead (or ahead 0) :behind (or behind 0)}))

(defn tip-contains-origin? []
  (zero? (:exit (sh "git" "merge-base" "--is-ancestor" "origin/main" "HEAD"))))

(defn merge-head-present? []
  (zero? (:exit (sh "git" "rev-parse" "-q" "--verify" "MERGE_HEAD"))))

;; BL-1236: the real predicate under test - git's own exit code from
;; `git merge-tree --write-tree`, classified by merge-verdict, never a text
;; search over its output.
(defn real-merge-verdict []
  (let [{:keys [exit]} (sh "git" "merge-tree" "--write-tree" "HEAD" "origin/main")]
    (master-main-reconcile-lib/merge-verdict exit)))

(def verdict
  (if force-verdict-arg
    (keyword force-verdict-arg)
    (real-merge-verdict)))

(def ahead-behind (rev-counts!))
(def ahead (:ahead ahead-behind))
(def behind (:behind ahead-behind))
(def conflict? (= verdict :conflict))
(def unavailable? (= verdict :unavailable))
(def mid? (merge-head-present?))
(def tip-ok? (tip-contains-origin?))

(def plan
  (master-main-reconcile-lib/absorb-dispatch-plan
   {:merge-head-present? mid?
    :behind behind
    :ahead ahead
    :tip-contains-origin? tip-ok?
    :would-conflict? conflict?
    :absorb-would-conflict? conflict?
    :verdict-unavailable? unavailable?}))

(def reset-performed? (atom false))
(def merge-attempted? (atom false))

(defn- reset-onto-origin! []
  (reset! reset-performed? true)
  (sh "git" "reset" "--hard" "origin/main"))

(def outcome
  (case plan
    :skip-human-merge-in-progress "human-merge-in-progress"
    :noop "noop"
    :verdict-unavailable "verdict-unavailable"
    :replay-bookkeeping (do (reset-onto-origin!) "rematched-bookkeeping")
    :refuse-rematch (do (reset-onto-origin!) "rematched-refuse")
    ;; :ff-absorb
    (let [result (master-main-reconcile-lib/absorb-with-merge!
                  {:ff! (fn []
                          (let [{:keys [exit]} (sh "git" "merge" "--ff-only" "--no-edit" "origin/main")]
                            {:success (zero? exit)}))
                   :merge! (fn []
                             (reset! merge-attempted? true)
                             (let [{:keys [exit]} (sh "git" "merge" "--no-edit" "origin/main")]
                               {:success (zero? exit)}))
                   :abort! (fn [] (sh "git" "merge" "--abort"))
                   :fallback! (fn [] (reset-onto-origin!) {:success true :outcome :rematched-refuse})})]
      (name (:outcome result)))))

(def head-after (:out (sh "git" "rev-parse" "HEAD")))

(println (json/generate-string
          {:verdict (name verdict)
           :plan (name plan)
           :outcome outcome
           :resetPerformed @reset-performed?
           :mergeAttempted @merge-attempted?
           :headBefore head-before
           :headAfter head-after}))
