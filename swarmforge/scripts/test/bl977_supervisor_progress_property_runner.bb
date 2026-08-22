#!/usr/bin/env bb
;; BL-977 property tests (coder-authored, declared invariants) over the
;; supervisor's health verdict and the daemon's in-flight sweep marker -
;; the REAL evaluate-health and the REAL run-sweep! + installed marker
;; writer, never a re-statement of either.
;;
;;   Invariant 1: "A demonstrably progressing daemon is never halted for a
;;   stall: :stalled requires evidence of true silence - no sweep in
;;   flight under its budget - never heartbeat-file mtime alone." Encoded:
;;   for ANY generated observation with the process alive and a sweep in
;;   flight within budget, the verdict is :healthy - with heartbeat and
;;   outbox ages drawn ADVERSARIALLY (far past the stall window by
;;   construction in half the draws), so a pass can never be explained by
;;   gentle inputs.
;;
;;   Invariant 2: "A genuine wedge is still caught within a bounded time:
;;   an in-flight sweep that outruns the in-sweep budget yields :stalled
;;   exactly as a missing heartbeat does today, and the marker advances
;;   only with the poll loop's own progress - never with mere process
;;   survival, so a wedged loop cannot forge liveness." Encoded two ways:
;;   (a) EQUIVALENCE - for any over-budget observation, the verdict equals
;;   evaluate-health over the same observation with the marker absent AND
;;   the heartbeat missing (the today-shape it must match); (b) the
;;   marker-advance half over the REAL run-sweep! with the REAL installed
;;   writer: while a sweep thunk is wedged (blocked), the on-disk marker's
;;   started_at_ms is FROZEN across samples (process survival alone never
;;   advances it), the pure verdict over that frozen marker flips to
;;   :stalled once the budget elapses, and after the thunk returns the
;;   marker reads idle.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - the under-budget :healthy clause dropped from evaluate-health ->
;;     invariant 1 failed on every adversarial draw (stalled while a sweep
;;     was demonstrably in flight - the 2026-08-20T07:55:35Z halt shape);
;;   - the over-budget heartbeat-voiding dropped (over-budget in-flight
;;     falls through with the REAL heartbeat age) -> invariant 2a failed
;;     on draws with a fresh heartbeat + over-budget sweep (healthy where
;;     the missing-heartbeat shape says stalled);
;;   - run-sweep!'s idle transition dropped -> invariant 2b failed (the
;;     marker still named the sweep after the thunk returned).

(require '[babashka.fs :as fs]
         '[clojure.string :as str]
         '[cheshire.core :as json])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def fixture-root (str (fs/create-temp-dir {:prefix "bl977-prop-"})))
;; BL-459 temp-dir trap (flagged by extension/test/tempDirTrapGuard.test.js):
;; the end-of-run delete-tree below never runs when an exception (or a
;; mid-run System/exit) leaves early - reclaim the root on EVERY exit path.
;; Tolerant of the happy path having already deleted it.
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
(def coverage (atom {:adversarial-heartbeat 0 :under-budget 0 :over-budget 0 :fresh-heartbeat-over-budget 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def STALL 30000)
(def BUDGET 225000)

(defn- gen-obs [s]
  (let [[hb-kind s1] (gen-int s 4)      ; 0 nil, 1 fresh, 2 past-stall, 3 way past
        [hb-extra s2] (gen-int s1 100000)
        heartbeat (case hb-kind 0 nil 1 (+ 100 hb-extra 0) 2 (+ STALL 1 hb-extra) 3 (+ 61803 hb-extra))
        heartbeat (if (= hb-kind 1) (min heartbeat (dec STALL)) heartbeat)
        [ob-kind s3] (gen-int s2 3)     ; 0 nil, 1 fresh, 2 past-stall
        [ob-extra s4] (gen-int s3 100000)
        outbox (case ob-kind 0 nil 1 (min (+ 100 ob-extra) (dec STALL)) 2 (+ STALL 1 ob-extra))]
    (when (and heartbeat (> heartbeat STALL)) (swap! coverage update :adversarial-heartbeat inc))
    [{:alive? true
      :heartbeat-age-ms heartbeat
      :pending-outbox-age-ms outbox
      :stall-ms STALL
      :in-sweep-budget-ms BUDGET}
     s4]))

;; ── invariant 1 + 2a over the pure verdict ─────────────────────────────────
(loop [i 0 s 13]
  (when (< i runs)
    (let [[obs s1] (gen-obs s)
          [flight-kind s2] (gen-int s1 2)  ; 0 under budget, 1 over budget
          [flight-extra s3] (gen-int s2 200000)
          age (if (zero? flight-kind) (min flight-extra BUDGET) (+ BUDGET 1 flight-extra))
          obs (assoc obs :in-flight-sweep-age-ms age)
          verdict (handoffd-supervisor/evaluate-health obs)]
      (if (zero? flight-kind)
        (do (swap! coverage update :under-budget inc)
            (when-not (= :healthy verdict)
              (swap! failures conj (str "FAIL invariant 1: verdict " verdict " with a sweep in flight "
                                        age "ms (budget " BUDGET ") - obs " (pr-str obs)))))
        (do (swap! coverage update :over-budget inc)
            (when (and (:heartbeat-age-ms obs) (< (:heartbeat-age-ms obs) STALL))
              (swap! coverage update :fresh-heartbeat-over-budget inc))
            (let [today-shape (handoffd-supervisor/evaluate-health
                               (-> obs (dissoc :in-flight-sweep-age-ms) (assoc :heartbeat-age-ms nil)))]
              (when-not (= today-shape verdict)
                (swap! failures conj (str "FAIL invariant 2a: over-budget verdict " verdict
                                          " differs from the missing-heartbeat shape " today-shape
                                          " - obs " (pr-str obs)))))))
      (recur (inc i) s3))))

;; ── invariant 2b: the REAL run-sweep! + REAL writer, wedged then released ──
(let [marker-path (str (fs/path fixture-daemon-dir "handoffd.sweep-marker"))
      _ (daemon-cycle-guard-lib/install-sweep-marker-writer! marker-path)
      release (promise)
      wedged-entered (promise)
      logs (atom [])
      worker (future
               (daemon-cycle-guard-lib/run-sweep!
                (fn [e d] (swap! logs conj [e d]))
                (fn [] (System/currentTimeMillis))
                "bl977-wedged-sweep"
                (fn [] (deliver wedged-entered true) @release)))
      read-marker (fn [] (json/parse-string (slurp marker-path) true))]
  @wedged-entered
  (Thread/sleep 50)
  (let [m1 (read-marker)
        _ (Thread/sleep 150)
        m2 (read-marker)]
    (when-not (= "bl977-wedged-sweep" (:sweep m1))
      (swap! failures conj (str "FAIL invariant 2b: marker does not name the in-flight sweep: " (pr-str m1))))
    (when-not (number? (:started_at_ms m1))
      (swap! failures conj (str "FAIL invariant 2b: marker carries no start instant: " (pr-str m1))))
    (when-not (= (:started_at_ms m1) (:started_at_ms m2))
      (swap! failures conj (str "FAIL invariant 2b: a WEDGED loop's marker advanced on mere process survival: "
                                (pr-str m1) " -> " (pr-str m2))))
    ;; the frozen marker, read through the supervisor's own reader, flips
    ;; the pure verdict to :stalled once the budget elapses
    (let [started (:started_at_ms m1)
          age-at (fn [now] (handoffd-supervisor/read-in-flight-sweep-age-ms now))
          verdict-at (fn [now] (handoffd-supervisor/evaluate-health
                                {:alive? true
                                 :heartbeat-age-ms (- now started)
                                 :pending-outbox-age-ms (+ STALL 5000)
                                 :stall-ms STALL
                                 :in-flight-sweep-age-ms (age-at now)
                                 :in-sweep-budget-ms BUDGET}))]
      (when-not (= :healthy (verdict-at (+ started 1000)))
        (swap! failures conj "FAIL invariant 2b: wedged-but-under-budget did not read healthy"))
      (when-not (= :stalled (verdict-at (+ started BUDGET 60000)))
        (swap! failures conj "FAIL invariant 2b: wedge past the in-sweep budget did not flip to stalled"))))
  (deliver release :done)
  @worker
  (let [m3 (json/parse-string (slurp marker-path) true)]
    (when-not (= "idle" (:sweep m3))
      (swap! failures conj (str "FAIL invariant 2b: marker not idle after the sweep returned: " (pr-str m3))))))

(fs/delete-tree fixture-root)

(let [{:keys [adversarial-heartbeat under-budget over-budget fresh-heartbeat-over-budget]} @coverage]
  (doseq [[k v floor] [[:adversarial-heartbeat adversarial-heartbeat 40]
                       [:under-budget under-budget 40]
                       [:over-budget over-budget 40]
                       [:fresh-heartbeat-over-budget fresh-heartbeat-over-budget 10]]]
    (when (< v floor)
      (swap! failures conj (str "FAIL generator coverage: " (name k) " reached only " v " of " runs " (floor " floor ")")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl977 supervisor-progress properties: " runs " pure draws + the real wedged run-sweep! marker"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
