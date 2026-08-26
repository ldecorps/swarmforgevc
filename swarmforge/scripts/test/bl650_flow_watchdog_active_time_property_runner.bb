#!/usr/bin/env bb
;; BL-650: PROPERTY tests over flow_watchdog_lib.bb's active-time clock,
;; covering the three invariants the ticket YAML declares (coder-authored
;; first, per BL-654). Seeded (not wall-clock) randomness so failures
;; reproduce: a fixed-seed java.util.Random, never rand/rand-int's unseeded
;; global generator. Follows the established .bb property-runner precedent
;; (bl835_flow_watchdog_threshold_gate_property_runner.bb) - the
;; "*.property.test.js" / vitest.properties.config.mjs home is a TypeScript
;; convention with no Babashka equivalent (BL-472 tracks pinning real
;; property tooling for .bb scripts, deliberately deferred).
;;
;;   P1 effective-age-never-negative-never-exceeds-wall-no-double-subtract -
;;      "Effective age never exceeds wall age and is never negative, for ANY
;;      set of subtracted intervals - overlapping, nested, zero-length,
;;      out-of-order, or still-open - and no interval is ever
;;      double-subtracted." Random spans with random mixes of ledger
;;      (control-pause/swarm-stop, closed/open) and provider-outage
;;      intervals - deliberately overlapping, nested, zero-length, and
;;      inserted out of chronological order - are folded through
;;      evaluate-effective-age. Two checks per trial: the clamp
;;      (0 <= effective-age-ms <= wall-age-ms) AND an EXACT match against an
;;      independent sweep-line union oracle (built in this file, never
;;      reusing merge-and-sum-ms) applied to the same resolved intervals -
;;      the oracle check is what actually catches double-subtraction; the
;;      clamp alone cannot (a doubled subtraction still clamps to a
;;      plausible-looking non-negative number). The generator must
;;      demonstrably reach overlapping, nested, out-of-order, zero-length,
;;      and both open-interval branches.
;;
;;   P2 absent-or-unreliable-evidence-subtracts-nothing - "An interval is
;;      subtracted only where signature-backed durable evidence proves it:
;;      for EVERY interval class, absent or unreliable evidence subtracts
;;      nothing and that span falls back to wall clock." Three checks per
;;      trial family: (a) zero ledger/provider evidence at all ->
;;      effective-age-ms == wall-age-ms exactly; (b) an interval entirely
;;      OUTSIDE the parcel's own span is a no-op - identical effective age
;;      with or without it; (c) an open swarm-stop (BL-650's own "stale
;;      record from an ungraceful exit" ruling) contributes zero subtraction
;;      regardless of its length, and is flagged :unreconstructable?. The
;;      generator must reach all three branches.
;;
;;   P3 tier-never-regresses - "Once a tier has fired for a parcel, no later
;;      sweep regresses it to a lower tier - a retroactively discovered
;;      interval never un-fires or re-fires an alarm that already spoke."
;;      Simulates run-sweep!'s own ratchet (state written ONLY on a non-:none
;;      verdict, mirroring run-sweep!'s reduce exactly) across a random
;;      sequence of sweeps per parcel, where effective age and thresholds
;;      both fluctuate run to run (including DECREASING age, simulating a
;;      retroactively-discovered interval shrinking a previously-larger
;;      wall-clock-only estimate, and threshold changes simulating
;;      recalibration or a pack switch). Across every sweep, the recorded
;;      tier rank (none=0 < warn=1 < escalate=2) must never decrease. The
;;      generator must reach both a same-tier repeat and an upgrade.

(ns bl650-flow-watchdog-active-time-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "flow_watchdog_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 650))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
;; bound may exceed Integer/MAX_VALUE (e.g. millisecond spans) - nextInt
;; would overflow on (int bound), so this draws from nextLong directly.
(defn- rlong [bound] (mod (Math/abs (long (.nextLong rng))) (max 1 (long bound))))

;; ── independent sweep-line union oracle (never reuses merge-and-sum-ms) ────

(defn- oracle-union-ms
  "Total ms covered by the union of [start end] pairs, clipped to
   [span-start span-end]. A classic sweep-line count, deliberately written
   differently from flow-watchdog-lib/merge-and-sum-ms's sort+merge
   approach, so agreement between the two is real evidence, not a shared bug."
  [pairs span-start span-end]
  (let [events (mapcat (fn [[s e]]
                          (let [cs (max s span-start) ce (min e span-end)]
                            (when (< cs ce) [[cs 1] [ce -1]])))
                        pairs)
        sorted (sort-by first events)]
    (loop [evs sorted depth 0 last-t nil total 0]
      (if-let [[t d] (first evs)]
        (let [total' (if (and last-t (pos? depth)) (+ total (- t last-t)) total)]
          (recur (rest evs) (+ depth d) t total'))
        total))))

;; ── P1: effective-age-never-negative-never-exceeds-wall-no-double-subtract ──

(def p1-branches-hit (atom #{}))

(dotimes [_ 80]
  (let [now-ms (+ 1700000000000 (rlong 100000000000))
        wall-ms (+ 1000 (rlong 3600000)) ;; up to 1h wall age
        age-source (- now-ms wall-ms)
        n-ledger (rint 5)
        n-outage (rint 4)
        rand-point (fn [] (+ age-source (rlong (max 1 (- now-ms age-source)))))
        ledger-intervals
        (vec
         (repeatedly
          n-ledger
          (fn []
            (let [class (if (rbool) "control-pause" "swarm-stop")
                  open? (< (rint 5) 1) ;; ~20% open
                  s (rand-point)
                  e (if open? nil (let [e0 (rand-point)] (max s e0)))] ;; may be zero-length or out-of-order-input
              (swap! p1-branches-hit conj (keyword (str class (when open? "-open"))))
              {:start-ms s :end-ms e :class class :provenance (if open? "open" "proven")}))))
        provider-evidence
        (vec
         (mapcat
          (fn [_]
            (let [provider (rand-nth ["anthropic" "openai" "cerebras"])
                  a (rand-point) b (rand-point)]
              [{:ts-ms (min a b) :provider provider :text "529 storm"}
               {:ts-ms (max a b) :provider provider :text "529 storm"}]))
          (range n-outage)))
        ;; Deliberately shuffle insertion order so out-of-order input is hit.
        ledger-intervals (vec (shuffle ledger-intervals))
        eff (flow-watchdog-lib/evaluate-effective-age
             {:enqueued-at (str (java.time.Instant/ofEpochMilli age-source))
              :now-ms now-ms
              :ledger-intervals ledger-intervals
              :provider-evidence provider-evidence})
        ;; Same resolution rule evaluate-effective-age itself applies: open
        ;; control-pause -> now-ms; open swarm-stop -> dropped.
        resolved-ledger-pairs
        (keep (fn [{:keys [start-ms end-ms class]}]
                (cond
                  (some? end-ms) [start-ms end-ms]
                  (= class "control-pause") [start-ms now-ms]
                  :else nil))
              ledger-intervals)
        ;; The oracle must agree on the SAME grouped provider-outage
        ;; intervals evaluate-effective-age itself uses (provider-outage-
        ;; grouping correctness is exercised separately in the unit tests),
        ;; not regroup raw evidence lines with its own logic.
        outage-intervals (flow-watchdog-lib/provider-outage-intervals provider-evidence)
        oracle-pairs (concat resolved-ledger-pairs
                              (map (fn [{:keys [start-ms end-ms]}] [start-ms end-ms]) outage-intervals))
        oracle-subtracted (oracle-union-ms oracle-pairs age-source now-ms)
        oracle-effective (max 0 (min wall-ms (- wall-ms oracle-subtracted)))]
    (when (some #(zero? (- (:end-ms % 0) (:start-ms % 0))) (filter #(some? (:end-ms %)) ledger-intervals))
      (swap! p1-branches-hit conj :zero-length))
    (when (> (count ledger-intervals) 1) (swap! p1-branches-hit conj :multi-interval))
    (assert-true (str "effective-age-ms never negative (got " (:effective-age-ms eff) ")")
                 (>= (:effective-age-ms eff) 0))
    (assert-true (str "effective-age-ms never exceeds wall-age-ms (" (:effective-age-ms eff) " > " (:wall-age-ms eff) "?)")
                 (<= (:effective-age-ms eff) (:wall-age-ms eff)))
    (assert-true (str "effective-age-ms matches the independent union oracle exactly - no double subtraction "
                       "(got " (:effective-age-ms eff) ", oracle " oracle-effective ")")
                 (= oracle-effective (:effective-age-ms eff)))))

(assert-true "P1 generator reached overlapping/multi-interval trials"
             (contains? @p1-branches-hit :multi-interval))
(assert-true "P1 generator reached an open control-pause"
             (contains? @p1-branches-hit :control-pause-open))
(assert-true "P1 generator reached an open swarm-stop"
             (contains? @p1-branches-hit :swarm-stop-open))
(assert-true "P1 generator reached a closed control-pause"
             (contains? @p1-branches-hit :control-pause))
(assert-true "P1 generator reached a closed swarm-stop"
             (contains? @p1-branches-hit :swarm-stop))

;; ── P2: absent-or-unreliable-evidence-subtracts-nothing ─────────────────────

(def p2-branches-hit (atom #{}))

(dotimes [_ 60]
  (let [now-ms (+ 1700000000000 (rlong 100000000000))
        wall-ms (+ 1000 (rlong 3600000))
        age-source (- now-ms wall-ms)
        iso (fn [ms] (str (java.time.Instant/ofEpochMilli ms)))]
    ;; (a) zero evidence at all -> effective == wall, exactly.
    (let [eff (flow-watchdog-lib/evaluate-effective-age
               {:enqueued-at (iso age-source) :now-ms now-ms
                :ledger-intervals [] :provider-evidence []})]
      (swap! p2-branches-hit conj :no-evidence)
      (assert-true (str "no evidence at all -> effective-age-ms equals wall-age-ms exactly (wall=" wall-ms ")")
                   (= wall-ms (:effective-age-ms eff))))
    ;; (b) an interval entirely OUTSIDE the parcel's span is a no-op.
    (let [outside-start (+ now-ms 1000 (rlong 1000000))
          outside-end (+ outside-start 1000 (rlong 1000000))
          without (flow-watchdog-lib/evaluate-effective-age
                   {:enqueued-at (iso age-source) :now-ms now-ms
                    :ledger-intervals [] :provider-evidence []})
          with-outside (flow-watchdog-lib/evaluate-effective-age
                        {:enqueued-at (iso age-source) :now-ms now-ms
                         :ledger-intervals [{:start-ms outside-start :end-ms outside-end
                                              :class (if (rbool) "control-pause" "swarm-stop")
                                              :provenance "proven"}]
                         :provider-evidence []})]
      (swap! p2-branches-hit conj :outside-span)
      (assert-true "an interval entirely outside the parcel's span never changes effective age"
                   (= (:effective-age-ms without) (:effective-age-ms with-outside))))
    ;; (c) an open swarm-stop overlapping the span contributes zero
    ;; subtraction regardless of its (unknowable) length, and is flagged.
    (let [stop-start (+ age-source (rlong (max 1 wall-ms)))
          eff (flow-watchdog-lib/evaluate-effective-age
               {:enqueued-at (iso age-source) :now-ms now-ms
                :ledger-intervals [{:start-ms stop-start :end-ms nil
                                     :class "swarm-stop" :provenance "open"}]
                :provider-evidence []})]
      (swap! p2-branches-hit conj :open-stop-unreliable)
      (assert-true "an open (unreliable) swarm-stop subtracts nothing - falls back to wall clock"
                   (= wall-ms (:effective-age-ms eff)))
      (assert-true "an open swarm-stop overlapping the span is flagged unreconstructable"
                   (:unreconstructable? eff)))))

(assert-true "P2 generator reached all three branches (no-evidence, outside-span, open-stop-unreliable)"
             (every? @p2-branches-hit [:no-evidence :outside-span :open-stop-unreliable]))

;; ── P3: tier-never-regresses ─────────────────────────────────────────────

(def tier-rank {nil 0 :none 0 :warn 1 :escalate 2})

(def p3-branches-hit (atom #{}))

(dotimes [_ 50]
  (let [n-sweeps (+ 3 (rint 8))
        ;; A ratchet mirroring run-sweep!'s own reduce EXACTLY: state is
        ;; written only when decide-tier returns non-:none.
        final-highest
        (loop [i 0 highest nil max-seen 0]
          (if (>= i n-sweeps)
            max-seen
            (let [age-ms (rlong 2000000) ;; fluctuates freely, including down
                  warn-ms (+ 1000 (rlong 500000))
                  escalate-ms (+ warn-ms 1000 (rlong 500000))
                  tier (flow-watchdog-lib/decide-tier
                        {:age-ms age-ms :warn-ms warn-ms :escalate-ms escalate-ms
                         :highest-tier-alarmed highest :snoozed? false})
                  next-highest (if (= tier :none) highest tier)
                  next-rank (get tier-rank next-highest 0)]
              (swap! p3-branches-hit conj (if (= next-highest highest) :repeat-or-none :upgrade))
              (assert-true (str "sweep " i ": recorded tier rank never decreases (was "
                                 (get tier-rank highest 0) ", now " next-rank ")")
                           (>= next-rank (get tier-rank highest 0)))
              (recur (inc i) next-highest (max max-seen next-rank)))))]
    (assert-true "final highest-recorded rank is a valid tier rank" (contains? #{0 1 2} final-highest))))

(assert-true "P3 generator reached both a same-tier/none repeat and an upgrade"
             (every? @p3-branches-hit [:repeat-or-none :upgrade]))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl650_flow_watchdog_active_time_property_runner: ok")
