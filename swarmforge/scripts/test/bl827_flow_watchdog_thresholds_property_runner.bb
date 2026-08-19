#!/usr/bin/env bb
;; BL-827 (coder.prompt Invariants, BL-654): property tests over
;; flow_watchdog_lib.bb's threshold calibration/resolution, encoding the
;; ticket's three declared invariants:
;;
;;   invariant 1 - "The watchdog is never disabled by its own calibration:
;;      absent, stale, malformed or unwritable threshold data always
;;      resolves to a usable warn/escalate pair, and every parcel is still
;;      evaluated." Encoded over resolve-thresholds fed ADVERSARIAL specs
;;      tables built by construction (nil tables, entries with missing /
;;      non-numeric / negative / inverted values): the result is always a
;;      positive pair with escalate strictly above warn. The
;;      every-parcel-still-evaluated half over a REAL corrupt/absent table
;;      file is asserted by the unit runner's own sweep fixtures and
;;      acceptance scenario 06 - a durable-file fault is one deterministic
;;      shape, not a generator's space.
;;
;;   invariant 2 - "decide-tier's input is only an age and a threshold pair
;;      - no route identity, type or dormancy signal reaches it by any
;;      path." Encoded as identity-permutation invariance BY CONSTRUCTION:
;;      two parcels sharing age/state whose route identities differ wildly
;;      (including identities that LOOK like calibration keys) always
;;      resolve+decide to the same tier whenever their resolved pairs are
;;      equal - plus the structural pin that tier-decision-input-keys is
;;      exactly the five allowed keys.
;;
;;   invariant 3 - "Escalate is strictly greater than warn for every
;;      resolved pair, from every source, including flat, sparse and
;;      adversarial sample sets." Encoded over thresholds-from-samples /
;;      build-threshold-table with flat (single repeated value, by
;;      construction), sparse (< min samples) and adversarial (extreme
;;      magnitude, boundary-of-gate, boundary-of-ceiling) sample sets, and
;;      over sanitize-global-pair with inverted/equal conf pairs.
;;
;; Seeded-LCG convention of this directory's other property runners.
;;
;; Non-vacuity proven by hand at authoring time: dropping resolve-thresholds'
;; numeric entry guard fails invariant 1 on its first malformed-entry table;
;; replacing (max (inc warn) esc) with plain esc in thresholds-from-samples
;; fails invariant 3's flat sets immediately; sneaking :from into
;; tier-decision-input-keys fails invariant 2's structural pin. All restored.

(ns bl827-flow-watchdog-thresholds-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "flow_watchdog_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def ^:private rng (java.util.Random. 827))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))
(defn- rbool [] (.nextBoolean rng))

(def valid-global {:warn-ms 900000 :escalate-ms 3600000})

;; ── invariant 1: adversarial tables always resolve to a usable pair ───────

(defn- garbage-entry []
  (rpick [nil
          {}
          {:warn-ms nil :escalate-ms 100}
          {:warn-ms "fast" :escalate-ms 100}
          {:warn-ms -5 :escalate-ms 100}
          {:warn-ms 0 :escalate-ms 100}
          {:warn-ms 100 :escalate-ms 100}          ; collapsed tiers
          {:warn-ms 200 :escalate-ms 100}          ; inverted
          {:warn-ms 100}                           ; missing escalate
          {:escalate-ms 100}
          {:warn-ms 120000 :escalate-ms 240000}])) ; the one valid shape

(defn- garbage-table []
  (rpick [nil
          {}
          (into {} (map (fn [i] [(str "r" i "->x|note") (garbage-entry)])
                        (range (inc (rint 4)))))]))

(def inv1-malformed-reached (atom 0))

(dotimes [_ runs]
  (let [table (garbage-table)
        parcel {:from (str "r" (rint 4)) :to "x" :type "note"}
        {:keys [warn-ms escalate-ms resolved-via]}
        (flow-watchdog-lib/resolve-thresholds parcel table valid-global)]
    (when (and (map? table) (some (fn [[_ v]] (not (and (map? v) (number? (:warn-ms v))))) table))
      (swap! inv1-malformed-reached inc))
    (when-not (and (number? warn-ms) (pos? warn-ms)
                   (number? escalate-ms) (> escalate-ms warn-ms)
                   (string? resolved-via))
      (swap! failures conj
             (str "FAIL inv1: unusable pair " {:warn warn-ms :esc escalate-ms :via resolved-via}
                  " for table " (pr-str table))))))

(when (zero? @inv1-malformed-reached)
  (swap! failures conj "FAIL reachability: no malformed-entry table generated"))

;; ── invariant 2: route identity never reaches the decision ────────────────

(when-not (= #{:age-ms :warn-ms :escalate-ms :highest-tier-alarmed :snoozed?}
             flow-watchdog-lib/tier-decision-input-keys)
  (swap! failures conj (str "FAIL inv2: tier-decision-input-keys widened to "
                            (pr-str flow-watchdog-lib/tier-decision-input-keys))))

;; identities crafted to LOOK like calibration keys - if any identity signal
;; leaked into the decision, permuting it while holding the resolved pair
;; fixed would flip a verdict somewhere in this space.
(def identity-pool
  [{:from "coder" :to "cleaner" :type "git_handoff"}
   {:from "*" :to "*" :type "note"}
   {:from "global" :to "global" :type "global"}
   {:from "a->b|note" :to "x" :type "note"}
   {:from "" :to "" :type ""}])

(def inv2-tier-fired (atom 0))

(dotimes [_ runs]
  (let [age (rint 4000000)
        prior (rpick [nil :warn :escalate])
        snoozed (rbool)
        table {}                                     ; both resolve global by construction
        decide (fn [parcel]
                 (let [{:keys [warn-ms escalate-ms]}
                       (flow-watchdog-lib/resolve-thresholds parcel table valid-global)]
                   (flow-watchdog-lib/decide-tier
                    {:age-ms age :warn-ms warn-ms :escalate-ms escalate-ms
                     :highest-tier-alarmed prior :snoozed? snoozed})))
        [ida idb] [(rpick identity-pool) (rpick identity-pool)]
        [ta tb] [(decide ida) (decide idb)]]
    (when-not (= ta tb)
      (swap! failures conj (str "FAIL inv2: identity changed the verdict: "
                                (pr-str ida) "->" ta " vs " (pr-str idb) "->" tb)))
    (when (not= ta :none) (swap! inv2-tier-fired inc))))

(when (zero? @inv2-tier-fired)
  (swap! failures conj "FAIL reachability: no firing tier generated for inv2"))

;; ── invariant 3: escalate strictly above warn, every source ───────────────

(def inv3-flat-reached (atom 0))
(def inv3-emitted-reached (atom 0))

(dotimes [_ runs]
  (let [shape (rint 3)
        n (case shape
            0 (+ 8 (rint 5))                        ; enough samples
            1 (rint 8)                              ; sparse by construction
            2 (+ 8 (rint 5)))
        value (rpick [60000 60001 900000 3600000 (* 900000 4) (inc (* 900000 4)) 999999999])
        samples (case shape
                  0 (repeat n value)                ; FLAT by construction
                  1 (repeatedly n #(rint 10000000))
                  2 (repeatedly n #(+ 60000 (rint 10000000))))
        ceiling (rpick [nil 3600000 (* 900000 4)])
        t (flow-watchdog-lib/thresholds-from-samples samples ceiling)]
    (when (= 0 shape) (swap! inv3-flat-reached inc))
    (when t
      (swap! inv3-emitted-reached inc)
      (when-not (> (:escalate-ms t) (:warn-ms t))
        (swap! failures conj (str "FAIL inv3: emitted pair not strictly ordered " (pr-str t)
                                  " for flat=" (= 0 shape) " n=" n))))
    ;; the sanitized global path: inverted/equal conf pairs come out ordered
    (let [warn (inc (rint 4000000))
          esc (rpick [warn (dec warn) (inc warn) (rint 4000000)])
          esc (if (pos? esc) esc 1)
          pair (flow-watchdog-lib/sanitize-global-pair {:warn-ms warn :escalate-ms esc})]
      (when-not (> (:escalate-ms pair) (:warn-ms pair))
        (swap! failures conj (str "FAIL inv3: sanitize-global-pair left " (pr-str pair)))))))

(when (< @inv3-flat-reached 50)
  (swap! failures conj (str "FAIL reachability: only " @inv3-flat-reached " flat sample sets")))
(when (< @inv3-emitted-reached 50)
  (swap! failures conj (str "FAIL reachability: only " @inv3-emitted-reached " emitted pairs")))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl827_flow_watchdog_thresholds_property_runner: ok (" runs " runs/invariant, "
                @inv1-malformed-reached " malformed tables, " @inv2-tier-fired " firing tiers, "
                @inv3-flat-reached " flat sets, " @inv3-emitted-reached " emitted pairs)")))
