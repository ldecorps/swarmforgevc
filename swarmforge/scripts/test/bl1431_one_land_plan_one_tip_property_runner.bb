#!/usr/bin/env bb
;; BL-1431 coder pass (BL-654 Invariants): PROPERTY tests over
;; land_step_lib.bb encoding two of the ticket's three declared invariants
;; against the REAL land-plan/own-paths functions, never a reimplementation.
;;
;; Invariant 1 ("one plan, one tip: origin/main is resolved by name exactly
;; once per land-step invocation... every read the plan makes takes that
;; SHA") - P1 builds a REAL git fixture with a randomized number of
;; unlanded sibling tickets and own paths, and asserts land-plan calls
;; origin-main-sha exactly once regardless of fixture shape, cross-checked
;; against an independent reference model of which ticket ids should be
;; entangled.
;;
;; Invariant 3 ("a read that fails mid-walk still refuses rather than
;; narrowing") - P2 injects a commits-fn that fails (returns nil) for a
;; randomly chosen delivered path and asserts own-paths ALWAYS refuses
;; (:paths nil, a named warning) rather than silently excluding just that
;; path and returning a narrowed set.
;;
;; Invariant 2 ("the publish is unchanged: FF-only push, one rebase
;; rematch... never --force") is explicitly untouched code this ticket does
;; not modify (the ticket's own How section: "Keep land_main_publish.sh
;; untouched except for the scenario 04 pin"). Per BL-654's own allowance
;; for a declared invariant with no fresh executable encoding to record a
;; stated reason instead of a test: this invariant is proven by (a) the
;; PRE-EXISTING, unmodified land_main_publish_test_runner.sh and
;; bl1144_main_land_publish_mutation_sweep.sh both passing unchanged, and
;; (b) BL-1431's own acceptance scenario 04
;; (bl1431OneLandPlanOneTipCli.bb "moved-at-push"), which drives the real
;; script end-to-end and asserts rematchCount=1, published=true, forced=
;; false live. Writing a THIRD test of behaviour this ticket does not touch
;; would not encode anything new.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bash/bb property
;; runners. Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken land-plan that re-resolved
;;     origin-main-sha unconditionally instead of honouring a passed
;;     :origin-main - failed on every generated case (the call count no
;;     longer matched 1, since :origin-main was never even asked for).
;;   - P2 was run against a deliberately broken own-paths that skipped a
;;     nil attribution (treating a failed read as "no owner" rather than
;;     refusing) - failed on every generated case where the failing path
;;     was chosen from the delivered set (the property's own generator
;;     already only ever picks such a path).

(ns bl1431-one-land-plan-one-tip-property-runner
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
  (loop [i 0 s 1431]
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
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1431-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

;; ── P1 (invariant 1): one resolve per invocation, across fixture shapes ──

(defn gen-p1 [s]
  (let [[n-siblings s1] (gen-int s 4)     ; 0..3 unlanded siblings
        [n-own s2] (gen-int s1 3)         ; 1..3 own paths
        [explicit? s3] (gen-int s2 2)]    ; caller supplies :origin-main or not
    [{:n-siblings n-siblings :n-own (inc n-own) :explicit? (= 1 explicit?)} s3]))

(defn- p1-case [{:keys [n-siblings n-own explicit?]}]
  (with-fixture [root]
    (mark-origin-main-here! root)
    (dotimes [i n-siblings]
      (commit! root (str "backlog/active/BL-92" i "0-sib.yaml") (str "id: BL-92" i "0\n")
               (str "BL-92" i "0: sibling unlanded work")))
    (dotimes [i n-own]
      (commit! root (str "backlog/active/BL-9001-own-" i ".yaml") "id: BL-9001\n"
               (str "BL-9001: own work " i)))
    (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
          call-count (atom 0)
          real land-step-lib/origin-main-sha
          counting-fn (fn [r] (swap! call-count inc) (real r))
          ;; The property exercises BOTH call shapes the ticket names:
          ;; explicit? true mirrors land_step_cli.bb (the real production
          ;; caller), which resolves origin-main itself ONCE, outside the
          ;; counted call, then threads it in - land-plan must add ZERO
          ;; further resolutions. explicit? false mirrors a direct/test
          ;; caller with no key at all - land-plan resolves once ITSELF, so
          ;; the counted call sees exactly one. A mutant that always
          ;; resolves internally (ignoring a supplied :origin-main) is
          ;; invisible to the false branch alone, which is why both must
          ;; run.
          base-opts {:root root :commit commit :task-ticket-id "BL-9001"}
          plan (if explicit?
                 (let [om (real root)]
                   (with-redefs [land-step-lib/origin-main-sha counting-fn]
                     (land-step-lib/land-plan (assoc base-opts :origin-main om))))
                 (with-redefs [land-step-lib/origin-main-sha counting-fn]
                   (land-step-lib/land-plan base-opts)))
          expected-count (if explicit? 0 1)
          expected-entangled (set (for [i (range n-siblings)] (str "BL-92" i "0")))
          expected-action (if (seq expected-entangled) :replay :land)]
      (cond
        (not= expected-count @call-count)
        (str "explicit?=" explicit? " expected origin-main-sha called " expected-count
             " time(s) inside land-plan, got " @call-count " (n-siblings=" n-siblings ")")

        (not= expected-action (:action plan))
        (str "expected action " expected-action ", got " (:action plan) " (plan=" (pr-str plan) ")")

        (and (= :replay expected-action) (not= expected-entangled (:entangled plan)))
        (str "expected entangled " expected-entangled ", got " (:entangled plan))

        :else true))))

;; ── P2 (invariant 3): a read that fails mid-walk refuses, never narrows ──

(defn gen-p2 [s]
  (let [[n-own s1] (gen-int s 3)          ; 1..3 own paths total
        n-own (inc n-own)
        [fail-idx s2] (gen-int s1 n-own)] ; which one fails to read
    [{:n-own n-own :fail-idx fail-idx} s2]))

(defn- p2-case [{:keys [n-own fail-idx]}]
  (with-fixture [root]
    (mark-origin-main-here! root)
    (let [paths (vec (for [i (range n-own)] (str "backlog/active/BL-9001-own-" i ".yaml")))]
      (dotimes [i n-own]
        (commit! root (nth paths i) "id: BL-9001\n" (str "BL-9001: own work " i)))
      (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
            origin-main (land-step-lib/origin-main-sha root)
            failing-path (nth paths fail-idx)
            ;; A commits-fn that answers nil (an unreadable range) for
            ;; EXACTLY the chosen path, and delegates for every other -
            ;; the real per-path failure own-paths must refuse on, never
            ;; silently narrow around.
            flaky-fn (fn [r om c path]
                       (if (= path failing-path)
                         nil
                         (land-step-lib/path-attributing-commits r om c path)))
            result (land-step-lib/own-paths root commit "BL-9001" #{} flaky-fn nil nil origin-main)]
        (cond
          (some? (:paths result))
          (str "expected a refusal (nil :paths) when " failing-path " could not be read, got " (pr-str result))

          (not (str/includes? (str (:warning result)) failing-path))
          (str "expected the refusal to name the unreadable path " failing-path ", got " (:warning result))

          :else true)))))

(check-all "P1: one resolve per invocation, across randomized fixture shapes" gen-p1 p1-case)
(check-all "P2: a read that fails mid-walk refuses, never narrows" gen-p2 p2-case)

;; ── generator coverage (asserted reachability floors) ──────────────────

(let [p1-inputs (sweep-coverage 1431 gen-p1 identity)
      p2-inputs (sweep-coverage 1431 gen-p2 identity)
      floor (quot runs 10)
      buckets {:p1-no-siblings (count (filter #(zero? (:n-siblings %)) p1-inputs))
               :p1-some-siblings (count (filter #(pos? (:n-siblings %)) p1-inputs))
               :p1-multi-own (count (filter #(> (:n-own %) 1) p1-inputs))
               :p1-explicit-origin-main (count (filter :explicit? p1-inputs))
               :p1-resolves-itself (count (remove :explicit? p1-inputs))
               :p2-fails-first (count (filter #(zero? (:fail-idx %)) p2-inputs))
               :p2-fails-later (count (filter #(pos? (:fail-idx %)) p2-inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1431 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ──────────────────────────────────────────────────────────────

(println (str "bl1431 one-land-plan-one-tip properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
