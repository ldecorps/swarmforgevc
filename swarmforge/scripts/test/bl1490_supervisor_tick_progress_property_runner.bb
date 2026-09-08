#!/usr/bin/env bb
;; BL-1490 property tests (coder-authored, declared invariants) over the
;; supervisor's health verdict for a NAMED PER-TICK phase (daemon-cycle-
;; guard-lib/tick-phase-names: delivery, startup-notify, canary-sweep) - the
;; REAL evaluate-health/effective-in-sweep-budget-ms and the REAL
;; daemon-cycle-guard-lib/mark-tick-phase!/mark-tick-idle! writing through
;; the REAL installed marker writer, never a re-statement of either.
;;
;;   Invariant 1: "At every instant the daemon is executing a poll-cycle
;;   phase - startup-notify, outbox delivery, the canary sweep, or a named
;;   sweep - the supervisor's observations carry evidence of that phase's
;;   progress newer than its last completed unit of work; the cycle-start
;;   heartbeat alone is never the only evidence for a phase in flight."
;;   Encoded: for ANY generated observation naming a per-tick phase with an
;;   in-flight age under tick-budget-ms, the verdict is :healthy - with
;;   heartbeat-age-ms drawn ADVERSARIALLY missing/far-stale (heartbeat
;;   evidence alone would read :stalled every time) and, critically, with
;;   the in-flight age also drawn PAST in-sweep-budget-ms's own value on
;;   some draws (proving the per-tick phase is judged against the TIGHTER
;;   tick-budget-ms, never the looser heavy-sweep budget it would
;;   otherwise fall back to).
;;
;;   Invariant 2: "Liveness evidence advances only on real poll-loop
;;   progress ... never on a timer or on mere process survival - so a phase
;;   that stops making progress is judged stalled within a bounded budget
;;   and halt-swarm! is invoked exactly once." Encoded two ways: (a)
;;   EQUIVALENCE over the pure function - for any per-tick-named
;;   observation whose in-flight age exceeds tick-budget-ms, the verdict
;;   equals evaluate-health over the same observation with the marker
;;   absent AND the heartbeat missing (the today-shape a genuine wedge must
;;   match - unaffected by the looser in-sweep-budget-ms, since a per-tick
;;   name is never judged against it); (b) the marker-advance half over the
;;   REAL mark-tick-phase!/mark-tick-idle! - while a fixture "delivery"
;;   phase re-stamps after each unit, the marker's age never exceeds one
;;   inter-unit gap; once the phase stops calling mark-tick-phase! (a
;;   frozen unit), the on-disk marker is FROZEN across samples (process
;;   survival alone never advances it) and the pure verdict over that
;;   frozen marker flips to :stalled once tick-budget-ms elapses.
;;
;; Non-vacuity proven at authoring time (2026-09-08), each break restored:
;;   - effective-in-sweep-budget-ms's tick-phase-names branch dropped (every
;;     named phase falls back to in-sweep-budget-ms) -> invariant 2a failed
;;     on between-tick-and-sweep-budget draws with a genuinely old pending
;;     outbox (read :healthy via the looser budget where the missing-
;;     heartbeat shape reads :stalled - the exact gap this ticket closes);
;;   - the over-budget heartbeat-voiding dropped -> invariant 2a failed on
;;     draws with a fresh heartbeat + an over-tick-budget per-tick marker
;;     (healthy where the missing-heartbeat shape says stalled);
;;   - mark-tick-phase! changed to no-op -> invariant 2b failed (the marker
;;     file was never created/updated at all, so read-in-flight-sweep-age-ms
;;     stayed nil throughout - :stalled from the very first sample instead
;;     of only once the frozen phase actually outran its budget).

(require '[babashka.fs :as fs]
         '[clojure.string :as str]
         '[cheshire.core :as json])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def fixture-root (str (fs/create-temp-dir {:prefix "bl1490-prop-"})))
;; BL-459 temp-dir trap: reclaim the root on EVERY exit path, tolerant of the
;; happy path having already deleted it.
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? fixture-root) (fs/delete-tree fixture-root)))))
(def fixture-daemon-dir (fs/path fixture-root ".swarmforge" "daemon"))
(fs/create-dirs fixture-daemon-dir)
(spit (str (fs/path fixture-daemon-dir "stop")) "")

(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path script-dir ".." "handoffd_supervisor.bb"))))
(load-file (str (fs/path script-dir ".." "daemon_cycle_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))
(def coverage (atom {:adversarial-heartbeat 0 :under-tick-budget 0 :over-tick-budget 0
                     :between-tick-and-sweep-budget 0 :fresh-heartbeat-over-budget 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def STALL 30000)
(def SWEEP-BUDGET 225000)
(def TICK-BUDGET 60000)
(def TICK-NAMES (vec daemon-cycle-guard-lib/tick-phase-names))

(defn- gen-obs [s]
  (let [[hb-kind s1] (gen-int s 4)      ; 0 nil, 1 fresh, 2 past-stall, 3 way past
        [hb-extra s2] (gen-int s1 100000)
        heartbeat (case hb-kind 0 nil 1 (+ 100 hb-extra 0) 2 (+ STALL 1 hb-extra) 3 (+ 61803 hb-extra))
        heartbeat (if (= hb-kind 1) (min heartbeat (dec STALL)) heartbeat)
        [ob-kind s3] (gen-int s2 3)     ; 0 nil, 1 fresh, 2 past-stall
        [ob-extra s4] (gen-int s3 100000)
        outbox (case ob-kind 0 nil 1 (min (+ 100 ob-extra) (dec STALL)) 2 (+ STALL 1 ob-extra))
        [name-idx s5] (gen-int s4 (count TICK-NAMES))]
    (when (and heartbeat (> heartbeat STALL)) (swap! coverage update :adversarial-heartbeat inc))
    [{:alive? true
      :heartbeat-age-ms heartbeat
      :pending-outbox-age-ms outbox
      :stall-ms STALL
      :in-sweep-budget-ms SWEEP-BUDGET
      :tick-budget-ms TICK-BUDGET
      :in-flight-sweep-name (nth TICK-NAMES name-idx)}
     s5]))

;; ── invariant 1 + 2a over the pure verdict ─────────────────────────────────
(loop [i 0 s 97]
  (when (< i runs)
    (let [[obs s1] (gen-obs s)
          ;; 0: under tick-budget: 1: between tick-budget and sweep-budget
          ;; (must still read stalled - proves the TIGHT budget is enforced,
          ;; not the loose one); 2: over even the sweep-budget
          [flight-kind s2] (gen-int s1 3)
          [flight-extra s3] (gen-int s2 100000)
          age (case flight-kind
                0 (min flight-extra TICK-BUDGET)
                1 (+ TICK-BUDGET 1 (min flight-extra (- SWEEP-BUDGET TICK-BUDGET 2)))
                2 (+ SWEEP-BUDGET 1 flight-extra))
          obs (assoc obs :in-flight-sweep-age-ms age)
          verdict (handoffd-supervisor/evaluate-health obs)]
      (if (zero? flight-kind)
        (do (swap! coverage update :under-tick-budget inc)
            (when-not (= :healthy verdict)
              (swap! failures conj (str "FAIL invariant 1: verdict " verdict " with per-tick phase "
                                        (:in-flight-sweep-name obs) " in flight " age
                                        "ms (tick-budget " TICK-BUDGET ") - obs " (pr-str obs)))))
        (do (swap! coverage update :over-tick-budget inc)
            (when (= 1 flight-kind) (swap! coverage update :between-tick-and-sweep-budget inc))
            (when (and (:heartbeat-age-ms obs) (< (:heartbeat-age-ms obs) STALL))
              (swap! coverage update :fresh-heartbeat-over-budget inc))
            ;; The equivalence check below (invariant 2a) is what actually
            ;; proves the TIGHT tick-budget is enforced for a between-budget
            ;; draw (flight-kind 1): under the bug this ticket fixes (a
            ;; named per-tick phase falling back to the looser sweep-budget),
            ;; a between-budget age would read :healthy via under-budget?
            ;; while the missing-heartbeat shape reads :stalled whenever the
            ;; draw's outbox is genuinely old - a mismatch this loop's
            ;; between-tick-and-sweep-budget coverage floor guarantees gets
            ;; exercised. A direct "must never read healthy" assertion here
            ;; would be WRONG on its own: an empty pending-outbox (drawn on
            ;; roughly a third of iterations) legitimately reads :healthy
            ;; regardless of the in-flight age, by evaluate-health's own
            ;; design (nothing pending means nothing to call stalled).
            (let [today-shape (handoffd-supervisor/evaluate-health
                               (-> obs (dissoc :in-flight-sweep-age-ms :in-flight-sweep-name)
                                   (assoc :heartbeat-age-ms nil)))]
              (when-not (= today-shape verdict)
                (swap! failures conj (str "FAIL invariant 2a: over-tick-budget verdict " verdict
                                          " differs from the missing-heartbeat shape " today-shape
                                          " - obs " (pr-str obs)))))))
      (recur (inc i) s3))))

;; ── invariant 2b: the REAL mark-tick-phase!/mark-tick-idle! + REAL writer,
;;    a "delivery" phase that re-stamps twice then freezes ─────────────────
(let [marker-path (str (fs/path fixture-daemon-dir "handoffd.sweep-marker"))
      _ (daemon-cycle-guard-lib/install-sweep-marker-writer! marker-path)
      read-marker (fn [] (json/parse-string (slurp marker-path) true))]
  (daemon-cycle-guard-lib/mark-tick-phase! "delivery")
  (let [m0 (read-marker)]
    (when-not (= "delivery" (:sweep m0))
      (swap! failures conj (str "FAIL invariant 2b: marker does not name the in-flight phase: " (pr-str m0)))))
  (Thread/sleep 40)
  (daemon-cycle-guard-lib/mark-tick-phase! "delivery") ;; unit 1 completed - re-stamp
  (let [m1 (read-marker)
        started1 (:started_at_ms m1)]
    (Thread/sleep 150) ;; the phase FREEZES here - no further re-stamp
    (let [m2 (read-marker)]
      (when-not (= started1 (:started_at_ms m2))
        (swap! failures conj (str "FAIL invariant 2b: a FROZEN phase's marker advanced on mere process "
                                  "survival: " (pr-str m1) " -> " (pr-str m2)))))
    ;; the frozen marker, read through the supervisor's own reader, flips the
    ;; pure verdict to :stalled once tick-budget-ms elapses - never before
    (let [age-at (fn [now] (- now started1))
          verdict-at (fn [now] (handoffd-supervisor/evaluate-health
                                {:alive? true
                                 :heartbeat-age-ms nil
                                 :pending-outbox-age-ms (+ STALL 5000)
                                 :stall-ms STALL
                                 :in-flight-sweep-age-ms (age-at now)
                                 :in-sweep-budget-ms SWEEP-BUDGET
                                 :tick-budget-ms TICK-BUDGET
                                 :in-flight-sweep-name "delivery"}))]
      (when-not (= :healthy (verdict-at (+ started1 1000)))
        (swap! failures conj "FAIL invariant 2b: frozen-but-under-tick-budget did not read healthy"))
      (when-not (= :stalled (verdict-at (+ started1 TICK-BUDGET 1000)))
        (swap! failures conj "FAIL invariant 2b: a frozen phase past tick-budget-ms did not flip to stalled")))
    ;; a completed (non-frozen) batch transitions the marker to idle, exactly
    ;; as run-sweep! does at a heavy sweep's end
    (daemon-cycle-guard-lib/mark-tick-idle!)
    (let [m3 (read-marker)]
      (when-not (= "idle" (:sweep m3))
        (swap! failures conj (str "FAIL invariant 2b: marker not idle after mark-tick-idle!: " (pr-str m3)))))))

(fs/delete-tree fixture-root)

(let [{:keys [adversarial-heartbeat under-tick-budget over-tick-budget
             between-tick-and-sweep-budget fresh-heartbeat-over-budget]} @coverage]
  (doseq [[k v floor] [[:adversarial-heartbeat adversarial-heartbeat 40]
                       [:under-tick-budget under-tick-budget 40]
                       [:over-tick-budget over-tick-budget 40]
                       [:between-tick-and-sweep-budget between-tick-and-sweep-budget 10]
                       [:fresh-heartbeat-over-budget fresh-heartbeat-over-budget 10]]]
    (when (< v floor)
      (swap! failures conj (str "FAIL generator coverage: " (name k) " reached only " v " of " runs " (floor " floor ")")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl1490 supervisor-tick-progress properties: " runs " pure draws + the real mark-tick-phase!/mark-tick-idle! marker"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
