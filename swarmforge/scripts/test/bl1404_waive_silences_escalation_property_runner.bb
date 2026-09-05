#!/usr/bin/env bb
;; BL-1404 coder pass (BL-654 Invariants): PROPERTY tests over the SAME
;; combined pipeline babysitter_check.bb's -main now runs
;; (babysitter-waive-lib/partition-findings -> both
;; babysitterd-sweep-lib/decide-nudges AND decide-escalations, fed the
;; SAME post-waive :to-nudge set), encoding the ticket's two declared
;; invariants:
;;
;;   1. "A waive is applied to the finding set ONCE, before both channels
;;      decide: a key the waive store names never nudges and never
;;      escalates, and the sweep log still reports it as WAIVED on the
;;      record." P1 generates an arbitrary set of findings (mixed CRIT/WARN
;;      severities, distinct keys) and an arbitrary waived subset, and
;;      asserts every waived key is absent from BOTH to-nudge and
;;      to-escalate, and present in :suppressed.
;;   2. "BL-1344's three bounds hold unchanged for the escalation channel:
;;      one key one waive, only a recorded decision waives, and an
;;      unusable store escalates everything rather than going quiet." P2
;;      asserts every UNWAIVED CRIT finding still escalates (one key one
;;      waive - waiving some keys never touches another's eligibility).
;;      P3 asserts an unreadable/malformed store escalates every CRIT
;;      finding, none silently dropped.
;;
;; Same deterministic-seeded-LCG shape as provider_auth_observe_lib_property_
;; runner.bb (BL-472: no mutation/property tooling wired for Babashka).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against the EXACT pre-BL-1404 defect (decide-escalations
;;     fed raw `findings` instead of the post-waive `to-nudge`) - failed on
;;     every generated case with at least one waived CRIT key (a waived
;;     CRIT finding still escalated).
;;   - P2 was run against a deliberately broken partition-findings that
;;     waived every finding whenever ANY key was waived (a class-wide
;;     waive, the shape BL-1344 invariant 1 forbids) - failed on every
;;     generated case with at least one waived key and at least one other
;;     unwaived CRIT finding.
;;   - P3 was run against a deliberately broken partition-findings that
;;     returned :to-nudge [] (not `findings`) on an unusable store - failed
;;     on every generated case with at least one CRIT finding.

(ns bl1404-waive-silences-escalation-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_waive_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 29]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- waive-store-text [keys]
  (apply str (map (fn [k] (str "- key: " k "\n  waived_by: coordinator\n  reason: \"investigated\"\n  waived_at: 2026-09-05\n"))
                   keys)))

;; ── shared generator: 2..8 findings, distinct keys, mixed severities,
;;    an arbitrary subset (from the SAME key pool, so some waives may name
;;    a key that is not even present) waived ─────────────────────────────

(defn gen-findings-and-waives [s]
  (let [[n-n s1] (gen-int s 7)
        n (+ 2 n-n) ;; 2..8
        keys (mapv #(str "finding-" %) (range n))
        [severities s2] (reduce (fn [[acc sx] _]
                                   (let [[crit? sy] (gen-bool sx)] [(conj acc (if crit? "CRIT" "WARN")) sy]))
                                 [[] s1] (range n))
        findings (mapv (fn [k sev] {:key k :severity sev :message (str "msg for " k)}) keys severities)
        ;; A per-key coin flip alone makes "zero waives at all" vanishingly
        ;; rare once n grows (2^-n) - a dedicated coin decides that case
        ;; directly first, so it stays well above the reachability floor
        ;; regardless of n.
        [any-waives? s3] (gen-bool s2)
        [waive-mask s4] (if any-waives?
                          (reduce (fn [[acc sx] _]
                                    (let [[b sy] (gen-bool sx)] [(conj acc b) sy]))
                                  [[] s3] (range n))
                          [(vec (repeat n false)) s3])
        waived-keys (vec (keep (fn [[k w?]] (when w? k)) (map vector keys waive-mask)))]
    [{:findings findings :waived-keys waived-keys} s4]))

(defn- run-pipeline [findings waived-keys]
  (let [read-result (babysitter-waive-lib/parse-waives (waive-store-text waived-keys))
        {:keys [to-nudge suppressed store-error]} (babysitter-waive-lib/partition-findings findings read-result)
        {nudged :to-nudge} (babysitterd-sweep-lib/decide-nudges to-nudge {:last-nudged-ms-by-key {} :now-ms 1000000 :cooldown-ms 1800000})
        {:keys [to-escalate]} (babysitterd-sweep-lib/decide-escalations to-nudge {:last-escalated-ms-by-key {} :now-ms 1000000 :cooldown-ms 1800000})]
    {:nudged nudged :to-escalate to-escalate :suppressed suppressed :store-error store-error}))

;; ── P1: a waived key never nudges, never escalates, and is recorded as
;;    suppressed ──────────────────────────────────────────────────────────

(check-all "P1: a waived key never nudges, never escalates, and is recorded as suppressed"
  gen-findings-and-waives
  (fn [{:keys [findings waived-keys]}]
    (let [waived-set (set waived-keys)
          {:keys [nudged to-escalate suppressed]} (run-pipeline findings waived-keys)
          escalated-keys (set (map :key to-escalate))
          nudged-keys (set (map :key nudged))
          suppressed-keys (set (map :key suppressed))
          findings-keys (set (map :key findings))
          waived-present (clojure.set/intersection waived-set findings-keys)]
      (cond
        (seq (clojure.set/intersection waived-set escalated-keys))
        (str "a waived key escalated: " (pr-str (clojure.set/intersection waived-set escalated-keys)))

        (seq (clojure.set/intersection waived-set nudged-keys))
        (str "a waived key nudged: " (pr-str (clojure.set/intersection waived-set nudged-keys)))

        (not= waived-present suppressed-keys)
        (str "expected suppressed=" (pr-str waived-present) " got " (pr-str suppressed-keys))

        :else true))))

;; ── P2: one key one waive - an UNWAIVED CRIT finding always escalates ────

(check-all "P2: an unwaived CRIT finding always escalates regardless of what else is waived"
  gen-findings-and-waives
  (fn [{:keys [findings waived-keys]}]
    (let [waived-set (set waived-keys)
          {:keys [to-escalate]} (run-pipeline findings waived-keys)
          escalated-keys (set (map :key to-escalate))
          expected-escalated (set (map :key (filter #(and (= "CRIT" (:severity %))
                                                            (not (contains? waived-set (:key %))))
                                                      findings)))]
      (or (= expected-escalated escalated-keys)
          (str "expected escalated=" (pr-str expected-escalated) " got " (pr-str escalated-keys))))))

;; ── P3: an unusable waive store escalates every CRIT finding, none
;;    silently dropped ───────────────────────────────────────────────────

(check-all "P3: an unusable/malformed waive store escalates every CRIT finding"
  (fn [s] (gen-findings-and-waives s)) ;; waived-keys is irrelevant here - the store never parses
  (fn [{:keys [findings]}]
    (let [read-result (babysitter-waive-lib/parse-waives "{{{ not a valid store")
          {:keys [to-nudge store-error]} (babysitter-waive-lib/partition-findings findings read-result)
          {:keys [to-escalate]} (babysitterd-sweep-lib/decide-escalations to-nudge {:last-escalated-ms-by-key {} :now-ms 1000000 :cooldown-ms 1800000})
          escalated-keys (set (map :key to-escalate))
          expected-escalated (set (map :key (filter #(= "CRIT" (:severity %)) findings)))]
      (cond
        (nil? store-error) "expected a store-error on malformed store text"
        (not= expected-escalated escalated-keys)
        (str "expected escalated=" (pr-str expected-escalated) " got " (pr-str escalated-keys))
        :else true))))

;; ── generator coverage (asserted reachability floors) ─────────────────────

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(let [inputs (sweep-coverage 29 gen-findings-and-waives identity)
      buckets {:has-waived-crit (count (filter (fn [{:keys [findings waived-keys]}]
                                                  (let [waived-set (set waived-keys)]
                                                    (some #(and (= "CRIT" (:severity %)) (contains? waived-set (:key %))) findings)))
                                                inputs))
               :has-unwaived-crit (count (filter (fn [{:keys [findings waived-keys]}]
                                                    (let [waived-set (set waived-keys)]
                                                      (some #(and (= "CRIT" (:severity %)) (not (contains? waived-set (:key %)))) findings)))
                                                  inputs))
               :no-waives-at-all (count (filter #(empty? (:waived-keys %)) inputs))}
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 29 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1404 waive-silences-escalation properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
