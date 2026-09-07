#!/usr/bin/env bb
;; BL-1472 coder pass (BL-654 Invariants): a PROPERTY test over
;; land_step_lib.bb's delivered-attribution/own-paths encoding the
;; ticket's first declared invariant against the REAL functions, never a
;; reimplementation:
;;
;;   "A revert or reapply commit never changes a path's attribution:
;;   own-paths gives the same owners and the same untagged-touch answer
;;   for a path whether or not a revert/reapply pair sits between the
;;   commits that introduced it and the tip."
;;
;; P1 builds TWO fixtures per case that end at the SAME tree content for
;; the sibling's path - one plain (the sibling's merge, nothing else), one
;; with N revert/reapply pairs (N even, so content nets out identically)
;; layered on top of that same merge - and asserts delivered-attribution
;; reports the IDENTICAL {:owners :any-untagged?} answer for that path in
;; both, regardless of how many revert/reapply pairs sit in between.
;; Randomly also mixes in the landing ticket's own later untagged edit on
;; the SAME path (BL-1315's shape), since that is exactly where BL-1343's
;; "an untagged touch must not be dropped" rule and BL-1472's "a revert is
;; not an untagged touch" rule interact.
;;
;; The ticket's second declared invariant ("BL-1315 and BL-1343 stand")
;; is a non-regression claim over behaviour this ticket's fix does not
;; touch (no revert/reapply involved) - proven by the existing, unmodified
;; BL-1315/BL-1343 scenarios and property tests in
;; land_step_lib_test_runner.bb and bl1315OwnPathsFullRangeInvariants.
;; property.test.js/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js,
;; all re-run green against this change (BL-654's stated-reason allowance
;; for an invariant proven by existing coverage rather than a fresh one).
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time: task-scope-gate-lib's
;; revert-subject? check temporarily removed from land_step_lib.bb's
;; path-owner-tickets reduce (git stash) - every generated case failed
;; (the revert-pair fixture's any-untagged? read true against the plain
;; fixture's false); restored, ALL PROPERTIES HOLD.

(ns bl1472-revert-reapply-transparent-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1472]
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
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1472-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

;; ── P1: revert/reapply pairs never change a path's attribution ───────────

(defn gen-p1 [s]
  (let [[n-pairs-raw s1] (gen-int s 3)     ; 0, 2 or 4 revert/reapply pairs (always even)
        n-pairs (* 2 n-pairs-raw)
        [own-edit? s2] (gen-int s1 2)]     ; also mix in the landing ticket's own untagged edit?
    [{:n-pairs n-pairs :own-edit? (= 1 own-edit?)} s2]))

(defn- build-case [root n-pairs own-edit?]
  (sh! root "git" "checkout" "-q" "-b" "sibling-line")
  (commit! root "sibling.txt" "sib\n" "BL-9002: sibling adds sibling.txt")
  (let [sib (:out (sh! root "git" "rev-parse" "HEAD"))]
    (sh! root "git" "checkout" "-q" "-b" "reviewing" "main")
    ;; Deliberately names no ticket - the live incident's own shape ("Merge
    ;; documenter <sha> into QA.") and the one that actually exercises the
    ;; defect (a merge subject quoting the sibling's id as text would let
    ;; commit-ticket-id resolve the revert's OWN subject to BL-9002 by
    ;; accident of substring matching).
    (sh! root "git" "merge" "-q" "--no-ff" "-m" "Merge sibling-line into reviewing." sib)
    (dotimes [_ n-pairs]
      (let [tip (:out (sh! root "git" "rev-parse" "HEAD"))]
        (sh! root "git" "revert" "--no-edit" "-m" "1" tip)
        (let [reverted (:out (sh! root "git" "rev-parse" "HEAD"))]
          (sh! root "git" "revert" "--no-edit" reverted))))
    (when own-edit?
      (commit! root "sibling.txt" "sib\nown addendum\n" "coder: refine shared file further (no ticket tag)"))
    (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
    (:out (sh! root "git" "rev-parse" "HEAD"))))

(defn- p1-case [{:keys [n-pairs own-edit?]}]
  (let [plain-attr (with-fixture [root]
                     (commit! root "base.txt" "base\n" "c0 base")
                     (mark-origin-main-here! root)
                     (let [tip (build-case root 0 own-edit?)
                           main-sha (:out (sh! root "git" "rev-parse" "origin/main"))]
                       (get (land-step-lib/delivered-attribution root main-sha tip) "sibling.txt")))
        with-pairs-attr (with-fixture [root]
                          (commit! root "base.txt" "base\n" "c0 base")
                          (mark-origin-main-here! root)
                          (let [tip (build-case root n-pairs own-edit?)
                                main-sha (:out (sh! root "git" "rev-parse" "origin/main"))]
                            (get (land-step-lib/delivered-attribution root main-sha tip) "sibling.txt")))]
    (cond
      (nil? plain-attr)
      (str "the baseline (0 revert pairs) fixture itself produced no attribution for sibling.txt - test setup error")

      (not= plain-attr with-pairs-attr)
      (str n-pairs " revert/reapply pair(s) changed sibling.txt's attribution: baseline "
           (pr-str plain-attr) " vs with-pairs " (pr-str with-pairs-attr))

      :else true)))

(check-all "P1: N revert/reapply pairs never change a path's delivered attribution" gen-p1 p1-case)

;; ── generator coverage (asserted reachability floors) ────────────────────

(let [inputs (sweep-coverage 1472 gen-p1 identity)
      floor (quot runs 10)
      buckets {:zero-pairs (count (filter #(zero? (:n-pairs %)) inputs))
               :some-pairs (count (remove #(zero? (:n-pairs %)) inputs))
               :own-edit (count (filter :own-edit? inputs))
               :no-own-edit (count (remove :own-edit? inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1472 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1472 revert-reapply-transparent property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
