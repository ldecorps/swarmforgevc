#!/usr/bin/env bb
;; BL-1473 coder pass (BL-654 Invariants): a PROPERTY test over
;; land_step_lib.bb encoding the ticket's first declared invariant against
;; the REAL own-paths function, never a reimplementation:
;;
;;   "A replay changes no path on origin/main that no commit in the
;;   parcel's own range (tip, not origin/main) touched: nothing main
;;   gained since the fork is deleted, nothing main deleted since the fork
;;   is resurrected, nothing main changed since the fork is reverted."
;;
;; P1 builds a REAL git fixture with a randomized set of paths, each
;; independently assigned one of five categories - the parcel's own
;; addition, the parcel's own deletion of a pre-fork path, a path
;; origin/main gains after the fork, a path origin/main deletes after the
;; fork, and a path origin/main changes after the fork - and asserts
;; own-paths' delivered set contains every :own-* path (reachability: the
;; parcel's own work must still land, so the property cannot pass by
;; excluding everything) and none of the three :main-* paths.
;;
;; The second declared invariant ("BL-1315 stands: every path the
;; parcel's content reached the branch through, including via a merge
;; before its own tagged merge, is delivered") is explicitly untouched
;; behaviour this ticket's fix does not alter - own-range-touched-paths is
;; the union of the parcel's WHOLE origin-main..commit diff (merge-base to
;; tip), which by construction includes content that arrived via an early
;; merge exactly as it always did. Per BL-654's allowance for a declared
;; invariant proven by existing coverage rather than a fresh encoding: it
;; is already exercised by land_step_lib_test_runner.bb's own BL-1315
;; scenarios (line ~429, "own-paths adds only the landed ticket's own
;; content") and by bl1374_sync_merge_passengers_property_runner.bb, both
;; unmodified and still green against this fix (verified by hand: the full
;; runner suite passes unchanged). Writing a second property over
;; behaviour this ticket's diff never touches would not encode anything
;; new.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time (own-range-touched-paths
;; temporarily stashed out of land_step_lib.bb, restored after): every
;; :main-gained/:main-deleted/:main-changed case failed on every generated
;; run (the pre-fix own-paths delivered all three), confirmed via
;; `git stash` around this exact file - see BL-1473's commit for the
;; before/after run transcript.

(ns bl1473-replay-no-untouched-path-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1473]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (:out (sh! root "git" "rev-parse" "HEAD"))))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1473-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

;; ── P1 (invariant 1): a replay never carries a path the parcel never touched

(def categories [:own-add :own-delete :main-gained :main-deleted :main-changed])

(defn gen-p1 [s]
  (let [[n s1] (gen-int s 5)          ; 3..7 candidate paths
        n (+ n 3)
        [cats s'] (reduce (fn [[acc s] i]
                             (let [[idx s2] (gen-int s 5)]
                               [(conj acc {:name (str "path-" i ".txt") :category (nth categories idx)}) s2]))
                           [[] s1]
                           (range n))]
    [cats s']))

(defn- p1-case [paths]
  (with-fixture [root]
    ;; Content is unique per path throughout (embeds the path's own name) so
    ;; a deletion paired with an unrelated addition of byte-identical
    ;; content is never misread by git's own rename detection as one
    ;; rename instead of two separate changes - which would otherwise drop
    ;; the deleted path from the two-tree diff's :name-only output
    ;; entirely, a fixture artifact this property must not confuse with
    ;; own-paths' own behaviour.
    ;;
    ;; Every path that must exist AT THE FORK (own-delete, main-deleted,
    ;; main-changed) is committed before the branch splits; main-gained and
    ;; own-add are deliberately absent at the fork.
    (doseq [{:keys [name category]} paths
            :when (contains? #{:own-delete :main-deleted :main-changed} category)]
      (commit! root name (str "fork content of " name "\n") (str "c0: seeds " name)))
    (sh! root "git" "checkout" "-q" "-b" "parcel")
    (doseq [{:keys [name category]} paths]
      (case category
        :own-add (commit! root name (str "own new content of " name "\n") (str "BL-9001: adds " name))
        :own-delete (do (sh! root "git" "rm" "-q" name)
                        (sh! root "git" "commit" "-q" "-m" (str "BL-9001: deletes " name)))
        nil))
    (let [parcel-commit (:out (sh! root "git" "rev-parse" "HEAD"))]
      (sh! root "git" "checkout" "-q" "main")
      (doseq [{:keys [name category]} paths]
        (case category
          :main-gained (commit! root name (str "main gains " name " after the fork\n") (str "main: gains " name))
          :main-deleted (do (sh! root "git" "rm" "-q" name)
                             (sh! root "git" "commit" "-q" "-m" (str "main: deletes " name)))
          :main-changed (commit! root name (str "main changes " name " after the fork\n") (str "main: changes " name))
          nil))
      (mark-origin-main-here! root)
      (let [result (land-step-lib/own-paths root parcel-commit "BL-9001")
            delivered (set (:paths result))
            offenders (for [{:keys [name category]} paths
                             :when (and (contains? #{:main-gained :main-deleted :main-changed} category)
                                        (contains? delivered name))]
                         name)
            missing-own (for [{:keys [name category]} paths
                               :when (and (contains? #{:own-add :own-delete} category)
                                          (not (contains? delivered name)))]
                           name)]
        (cond
          (nil? (:paths result))
          (str "own-paths refused unexpectedly: " (:warning result))

          (seq offenders)
          (str "own-paths delivered path(s) the parcel never touched, main-only since the fork: "
               (str/join ", " offenders) " (delivered=" (pr-str delivered) ", input=" (pr-str paths) ")")

          (seq missing-own)
          (str "own-paths dropped the parcel's own path(s): " (str/join ", " missing-own)
               " (delivered=" (pr-str delivered) ", input=" (pr-str paths) ")")

          :else true)))))

(check-all "P1: a replay never carries a path the parcel's own range never touched" gen-p1 p1-case)

;; ── generator coverage (asserted reachability floors) ────────────────────
;; Every category must actually be generated across the run set - a
;; property that never builds a :main-changed path, say, would pass
;; whether or not the reversion guard existed at all.

(let [inputs (sweep-coverage 1473 gen-p1 identity)
      all-cats (mapcat #(map :category %) inputs)
      floor (quot runs 10)
      buckets (into {} (for [c categories] [c (count (filter #(= c %) all-cats))]))]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1473 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1473 replay-no-untouched-path property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
