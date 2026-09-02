#!/usr/bin/env bb
;; BL-1310 acceptance driver: reproduces handoffd.bb's master-main-reconcile
;; entry point end to end (verdict -> absorb-dispatch-plan -> execution),
;; the same shape bl1236ReconcileSweepCli.bb already established, but with
;; the BL-1310 fix applied to the reset execution: the raw `git reset --hard
;; origin/main` adapter is wrapped by master_main_reconcile_lib.bb's
;; reset-authorized-by-ahead-count?, exactly as handoffd.bb's own
;; refuse-reset-if-local-ahead! wraps it (:3188). Ahead/behind, tip-
;; contains-origin?, merge-head-present?, and the actual git reset/merge
;; commands are all real; only the merge verdict may be forced
;; (--force-verdict=..., same documented lever bl1236ReconcileSweepCli.bb
;; uses - genuinely making `git merge-tree --write-tree` fail on cue is not
;; portably reproducible from a scripted fixture) and the ahead-count read
;; that gates the reset may separately be forced undeterminable
;; (--force-ahead-undeterminable), the one input scenario 04 needs that a
;; real git process cannot be made to misbehave on cue either (there is no
;; portable way to make `git rev-list --left-right --count` itself fail
;; against a healthy ref).
;;
;; Usage: bb bl1310ReconcileRefusesLocalAheadCli.bb <repo-root>
;;          [--force-verdict=clean|conflict|unavailable]
;;          [--force-ahead-undeterminable]
;; Prints one JSON line:
;;   {"verdict":str,"plan":str,"outcome":str,
;;    "resetPerformed":bool,"resetRefused":bool,
;;    "headBefore":str,"headAfter":str}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "master_main_reconcile_lib.bb")))

(def root (first *command-line-args*))
(def flags (set (rest *command-line-args*)))
(def force-verdict-arg
  (some #(when (str/starts-with? % "--force-verdict=") (subs % (count "--force-verdict=")))
        flags))
(def force-ahead-undeterminable? (contains? flags "--force-ahead-undeterminable"))

(when-not root
  (binding [*out* *err*]
    (println "usage: bl1310ReconcileRefusesLocalAheadCli.bb <repo-root> [--force-verdict=clean|conflict|unavailable] [--force-ahead-undeterminable]"))
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

;; BL-1310: the real ahead-count adapter refuse-reset-if-local-ahead! reads
;; fresh right before a reset would fire (master-main-local-ahead-count! in
;; handoffd.bb) - mirrored here against the same real git rev-list, with the
;; one documented test-only override scenario 04 needs.
(defn ahead-count! []
  (if force-ahead-undeterminable?
    nil
    (:ahead (rev-counts!))))

(defn tip-contains-origin? []
  (zero? (:exit (sh "git" "merge-base" "--is-ancestor" "origin/main" "HEAD"))))

(defn merge-head-present? []
  (zero? (:exit (sh "git" "rev-parse" "-q" "--verify" "MERGE_HEAD"))))

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
(def reset-refused? (atom false))

;; BL-1310: the SAME gate handoffd.bb's refuse-reset-if-local-ahead! applies
;; - only proceeds to the raw reset when the ahead-count is a known 0.
;; Returns the outcome NAME string: success-outcome-name when the reset ran,
;; "local-ahead-refused" when it was refused instead.
(defn- gated-reset! [success-outcome-name]
  (let [current-ahead (ahead-count!)]
    (if (master-main-reconcile-lib/reset-authorized-by-ahead-count? current-ahead)
      (do (reset! reset-performed? true)
          (sh "git" "reset" "--hard" "origin/main")
          success-outcome-name)
      (do (reset! reset-refused? true)
          "local-ahead-refused"))))

(def outcome
  (case plan
    :skip-human-merge-in-progress "human-merge-in-progress"
    :noop "noop"
    :verdict-unavailable "verdict-unavailable"
    :replay-bookkeeping (gated-reset! "rematched-bookkeeping")
    :refuse-rematch (gated-reset! "rematched-refuse")
    ;; :ff-absorb
    (let [result (master-main-reconcile-lib/absorb-with-merge!
                  {:ff! (fn []
                          (let [{:keys [exit]} (sh "git" "merge" "--ff-only" "--no-edit" "origin/main")]
                            {:success (zero? exit)}))
                   :merge! (fn []
                             (let [{:keys [exit]} (sh "git" "merge" "--no-edit" "origin/main")]
                               {:success (zero? exit)}))
                   :abort! (fn [] (sh "git" "merge" "--abort"))
                   :fallback! (fn [] {:success true :outcome (keyword (gated-reset! "rematched-refuse"))})})]
      (name (:outcome result)))))

(def head-after (:out (sh "git" "rev-parse" "HEAD")))

;; The actual operator-facing report text (qa_e2e_procedure step 3: an
;; operator who never opens a reflog must be able to tell from this line
;; alone why nothing moved) - the SAME surface-message handoffd.bb's own
;; handle-blocked!/surface! path sends to the coordinator note.
(def message
  (when @reset-refused?
    (master-main-reconcile-lib/surface-message {:behind behind :reason :local-ahead-refused})))

(println (json/generate-string
          {:verdict (name verdict)
           :plan (name plan)
           :outcome outcome
           :resetPerformed @reset-performed?
           :resetRefused @reset-refused?
           :message message
           :headBefore head-before
           :headAfter head-after}))
