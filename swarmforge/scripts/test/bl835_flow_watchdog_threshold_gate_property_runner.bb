#!/usr/bin/env bb
;; BL-835: PROPERTY tests over flow_watchdog_lib.bb, covering the three
;; invariants the ticket YAML declares (coder-authored first, per BL-654).
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator. Follows
;; the established .bb property-runner precedent (see
;; bl809_worktree_head_property_runner.bb) - the "*.property.test.js" /
;; vitest.properties.config.mjs home is a TypeScript convention with no
;; Babashka equivalent (BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred).
;;
;;   P1 reject-gate-not-a-floor - "A calibrated specs entry is emitted only
;;      when the raw warn percentile is >= min-warn-ms; the floor never
;;      invents a warn threshold." Across randomly generated duration sample
;;      sets (size >= min-samples-for-calibration, magnitudes spanning both
;;      sides of the gate), thresholds-from-samples must return nil whenever
;;      the raw p67 sits below min-warn-ms, and whenever it clears the gate
;;      the emitted :warn-ms must equal the raw percentile EXACTLY - never a
;;      clamped-up value. The generator must demonstrably reach both branches.
;;
;;   P2 resolution-hides-route-identity-from-decide-tier - "decide-tier still
;;      never sees from/to/type/dormancy; resolution stays outside it." A
;;      differential property: two structurally different random routes
;;      (different from/to/type, different specs-table shapes - one resolved
;;      via an exact key, one via global fallback) that happen to resolve to
;;      the SAME numeric warn/escalate pair must produce IDENTICAL decide-tier
;;      verdicts for the same age/highest-tier/snoozed inputs - decide-tier
;;      cannot distinguish the routes because resolve-thresholds's own output
;;      map never carries from/to/type, only numbers.
;;
;;   P3 rejected-or-absent-calibration-still-resolves - "Absent or rejected
;;      calibration still resolves to a usable warn/escalate pair (global
;;      fallback); the watchdog never disables itself." Across randomly
;;      generated specs tables - including ones built from REAL sub-gate
;;      sample sets that thresholds-from-samples rejects to nil, and entirely
;;      empty tables - resolve-thresholds must always return a positive,
;;      numeric {:warn-ms :escalate-ms} pair with escalate > warn, never nil
;;      and never a thrown exception. The generator must reach both a
;;      fully-rejected/empty table and a populated one.

(ns bl835-flow-watchdog-threshold-gate-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "flow_watchdog_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 835))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rlong [bound] (long (rint bound)))

;; ── P1: reject-gate-not-a-floor ──────────────────────────────────────────

(def p1-branches-hit (atom #{}))

(dotimes [_ 60]
  (let [n (+ flow-watchdog-lib/min-samples-for-calibration (rint 20))
        ;; A uniform draw across one wide range almost never lands its p67
        ;; below the gate (67% of draws would all have to fall under 60000
        ;; by chance) - so the generator explicitly targets each side of the
        ;; gate, alternated by coin flip, while still randomizing magnitude
        ;; within that side so the exact raw percentile varies run to run.
        sub-gate? (rbool)
        durations (if sub-gate?
                    (repeatedly n #(rlong flow-watchdog-lib/min-warn-ms))
                    (repeatedly n #(+ flow-watchdog-lib/min-warn-ms (rlong 300000))))
        raw (long (flow-watchdog-lib/percentile-ms durations flow-watchdog-lib/warn-percentile))
        result (flow-watchdog-lib/thresholds-from-samples durations)]
    (if (< raw flow-watchdog-lib/min-warn-ms)
      (do
        (swap! p1-branches-hit conj :rejected)
        (assert-true (str "raw p67 " raw "ms below the " flow-watchdog-lib/min-warn-ms "ms gate must emit no entry (n=" n ")")
                     (nil? result)))
      (do
        (swap! p1-branches-hit conj :calibrated)
        (assert-true (str "raw p67 " raw "ms clearing the gate must calibrate, not reject (n=" n ")")
                     (some? result))
        (when result
          (assert-true (str "calibrated warn-ms must equal the raw percentile exactly, never clamped (raw=" raw ", got=" (:warn-ms result) ")")
                        (= raw (:warn-ms result)))
          (assert-true "calibrated escalate-ms must stay strictly above warn-ms"
                        (> (:escalate-ms result) (:warn-ms result))))))))

(assert-true "P1 generator reached both a sub-gate rejection and a gate-clearing calibration"
             (and (contains? @p1-branches-hit :rejected) (contains? @p1-branches-hit :calibrated)))

;; ── P2: resolution-hides-route-identity-from-decide-tier ─────────────────

(defn- rword [] (str "r" (rint 1000000)))

(def p2-branches-hit (atom #{}))

(dotimes [_ 40]
  (let [warn-ms (+ 1000 (rlong 500000))
        escalate-ms (+ warn-ms 1000 (rlong 500000))
        pair {:warn-ms warn-ms :escalate-ms escalate-ms}
        route-a {:from (rword) :to (rword) :type (rword)}
        route-b {:from (rword) :to (rword) :type (rword)}
        ;; Route A resolves via an EXACT spec-table hit; route B resolves via
        ;; the GLOBAL fallback with the identical numeric pair - two
        ;; structurally different resolution paths landing on the same numbers.
        specs-a {(flow-watchdog-lib/spec-key route-a) (assoc pair :n 20 :source "exact")}
        via (if (rbool) :exact :to-type)
        specs-a (if (= via :to-type)
                  {(flow-watchdog-lib/to-type-key route-a) (assoc pair :n 20 :source "to-type")}
                  specs-a)
        resolved-a (flow-watchdog-lib/resolve-thresholds route-a specs-a {:warn-ms 1 :escalate-ms 2})
        resolved-b (flow-watchdog-lib/resolve-thresholds route-b {} pair)
        age-ms (rlong 1000000)
        highest (rword)
        input-fn (fn [resolved]
                   {:age-ms age-ms
                    :warn-ms (:warn-ms resolved)
                    :escalate-ms (:escalate-ms resolved)
                    :highest-tier-alarmed (when (rbool) (keyword highest))
                    :snoozed? false})
        ;; Both inputs are built from the SAME highest-tier-alarmed coin flip
        ;; so only the resolved numbers (never route-a/route-b's identity)
        ;; can drive a difference in decide-tier's verdict.
        snoozed? false
        highest-kw (when (rbool) :warn)
        tier-a (flow-watchdog-lib/decide-tier {:age-ms age-ms :warn-ms (:warn-ms resolved-a) :escalate-ms (:escalate-ms resolved-a)
                                                :highest-tier-alarmed highest-kw :snoozed? snoozed?})
        tier-b (flow-watchdog-lib/decide-tier {:age-ms age-ms :warn-ms (:warn-ms resolved-b) :escalate-ms (:escalate-ms resolved-b)
                                                :highest-tier-alarmed highest-kw :snoozed? snoozed?})]
    (swap! p2-branches-hit conj via)
    (assert-true (str "resolve-thresholds output must carry only :warn-ms/:escalate-ms/:resolved-via, never route identity (got keys " (keys resolved-a) ")")
                 (= #{:warn-ms :escalate-ms :resolved-via} (set (keys resolved-a))))
    (assert-true (str "two structurally different routes resolving to the same numeric pair (" pair ") must yield the SAME decide-tier verdict "
                       "(route-a via " via " -> " tier-a ", route-b via global -> " tier-b ")")
                 (= tier-a tier-b))))

(assert-true "P2 generator reached both exact-key and to-type-key resolution paths"
             (and (contains? @p2-branches-hit :exact) (contains? @p2-branches-hit :to-type)))

;; ── P3: rejected-or-absent-calibration-still-resolves ────────────────────

(def p3-branches-hit (atom #{}))

(dotimes [_ 40]
  (let [global {:warn-ms (+ 1000 (rlong 500000)) :escalate-ms (+ 600000 (rlong 500000))}
        route {:from (rword) :to (rword) :type (rword)}
        n (+ flow-watchdog-lib/min-samples-for-calibration (rint 10))
        ;; A REAL sample set run through the actual calibrator (never a
        ;; hand-built specs map): sub-gate durations reject to an empty
        ;; table, gate-clearing durations populate it via the exact key.
        populated? (rbool)
        durations (if populated?
                    (repeatedly n #(+ flow-watchdog-lib/min-warn-ms (rlong 300000)))
                    (repeatedly n #(rlong flow-watchdog-lib/min-warn-ms)))
        specs (flow-watchdog-lib/build-threshold-table
               (map (fn [d] (assoc route :duration-ms d)) durations))]
    (swap! p3-branches-hit conj (if (empty? specs) :empty :populated))
    (let [resolved (try (flow-watchdog-lib/resolve-thresholds route specs global)
                         (catch Exception e {:threw (.getMessage e)}))]
      (assert-true (str "resolve-thresholds must never throw for route " route " specs=" specs)
                    (not (:threw resolved)))
      (assert-true (str "resolve-thresholds must always return a usable pair, never nil (route=" route ")")
                    (some? resolved))
      (when (and resolved (not (:threw resolved)))
        (assert-true "resolved warn-ms must be a positive number"
                      (and (number? (:warn-ms resolved)) (pos? (:warn-ms resolved))))
        (assert-true "resolved escalate-ms must be strictly above warn-ms"
                      (> (:escalate-ms resolved) (:warn-ms resolved)))))))

(assert-true "P3 generator reached both an empty/fully-rejected specs table and a populated one"
             (and (contains? @p3-branches-hit :empty) (contains? @p3-branches-hit :populated)))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "bl835_flow_watchdog_threshold_gate_property_runner: ok")
