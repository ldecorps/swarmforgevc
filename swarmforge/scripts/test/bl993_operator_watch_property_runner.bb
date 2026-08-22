#!/usr/bin/env bb
;; BL-993 declared invariants, coder-first (BL-654). Generative sweep over
;; synthetic per-tick decisions against the REAL operator_runtime_watch_lib.bb
;; decide (the gate + front_desk_supervisor_lib.bb's check-one!, the EXACT
;; composition operator_runtime_supervisor.bb's own check! calls - see its
;; own check-one-fn injection).
;;
;;   Invariant 1 (deliberate stop is never undone): whenever the
;;     skip-operator env flag or the park flag is in effect, decide never
;;     spawns - checked against entries in every state that WOULD otherwise
;;     restart (not-started, a waiting entry past its backoff due-ms, a
;;     gave-up entry past its cooldown) - and the tracked entry is returned
;;     unchanged (no state mutation either).
;;   Invariant 2 (a restart is never silent): decide's own event, run over
;;     entries directed at each of the 6 events reachable through this
;;     ticket's actual wiring (:started/:crashed/:healthy-reset/:gave-up/
;;     :re-armed/nil - :stalled is provably unreachable here: the watch
;;     calls check-one! with the heartbeat-stale? arg always defaulted
;;     false, since operator_runtime.bb has no poll-heartbeat file), is fed
;;     to the REAL announce composition
;;     (operator-runtime-watch-lib/announcement-for-event - the exact
;;     function the supervisor's own announce-for-event! calls) and checked
;;     against the SPEC's classification: a restart-or-escalation event
;;     always yields a non-blank announcement, anything else yields nil.
;;     The oracle is deliberately NOT derived from announced-event? - the
;;     2026-08-21 architect bounce
;;     (backlog/evidence/BL-993-bounce-20260821-architect.md) was exactly
;;     that shape: two inline copies of the announced set compared against
;;     each other while the real dispatch went unexercised.
;;
;; Invariant 3 (the watcher is never the watched) is a process-architecture
;; fact, not a pure decision - no generator over "is this OS process
;; independent of that one" makes sense. Verified deterministically instead
;; by bl993_watch_survives_runtime_death.sh (real supervisor process, real
;; fixture "operator" process, real kill - acceptance scenario 05) - see
;; that script and BL-993's own coder handoff for the stated reason this
;; invariant has no property test here (BL-654's "declared invariant that
;; admits no executable encoding" clause).
;;
;; Reach floors (absolute, never scaled by a low PROPERTY_RUNS - see
;; lesson_property_runner_reachability_floors_are_absolute_not_scaled.md):
;; each of the 6 invariant-2 event categories >= 5; each of the 3
;; invariant-1 "would-otherwise-restart" categories >= 5.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "front_desk_supervisor_lib.bb")))
(load-file (str (fs/path script-dir ".." "operator_runtime_watch_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 120))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-bool* [] (zero? (rand-int* 2)))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

(def restart-config {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 600000})
(def giveup-config {:giveup-cooldown-ms 900000})

(defn counting-spawn! [counter]
  (fn [] (swap! counter inc) (+ 9000 (rand-int* 1000))))

;; ── invariant-1 generators: entries that WOULD restart if not gated ──────
(def i1-coverage (atom {:not-started 0 :waiting-due 0 :gave-up-cooldown-elapsed 0}))

(defn i1-entry+now []
  (let [kind (rand-nth* [:not-started :waiting-due :gave-up-cooldown-elapsed])]
    (swap! i1-coverage update kind inc)
    (case kind
      ;; decide does NOT substitute default-entry for a nil entry itself -
      ;; that happens in operator_runtime_supervisor.bb's own check! before
      ;; it ever calls decide (via initial-entry/read-state). Passing nil
      ;; straight through here reproduced exactly that gap the first time
      ;; this property ran (draw failures: "produced <blank>" instead of
      ;; :started) - pass the real default-entry the production wiring
      ;; would actually hand decide.
      :not-started
      [(front-desk-supervisor-lib/default-entry) 1000]

      :waiting-due
      (let [attempts (inc (rand-int* (:max-attempts restart-config)))
            crashed-at (+ 1000 (rand-int* 5000))
            now (+ crashed-at (:backoff-max-ms restart-config) 1 (rand-int* 1000))]
        [{:pid nil :attempts attempts :status "waiting" :crashed-at-ms crashed-at
          :started-at-ms nil :gave-up-at-ms nil}
         now])

      :gave-up-cooldown-elapsed
      (let [gave-up-at (+ 1000 (rand-int* 5000))
            now (+ gave-up-at (:giveup-cooldown-ms giveup-config) 1 (rand-int* 1000))]
        [{:pid nil :attempts (:max-attempts restart-config) :status "gave-up" :crashed-at-ms nil
          :started-at-ms nil :gave-up-at-ms gave-up-at}
         now]))))

(dotimes [i runs]
  (let [[entry now-ms] (i1-entry+now)
        skip-env (rand-bool*)
        parked (if skip-env (rand-bool*) true) ;; at least one always true
        spawn-count (atom 0)
        result (operator-runtime-watch-lib/decide
                {:skip-env skip-env :parked parked :entry entry :now-ms now-ms
                 :pid-alive? (constantly false)
                 :spawn! (counting-spawn! spawn-count)
                 :restart-config restart-config :giveup-config giveup-config
                 :check-one-fn front-desk-supervisor-lib/check-one!})]
    (when (not= :deliberately-stopped (:event result))
      (fail! (str "draw " i ": deliberately-stopped (skip=" skip-env " parked=" parked
                  ") but decide's event was " (:event result) ", entry=" (pr-str entry))))
    (when (pos? @spawn-count)
      (fail! (str "draw " i ": deliberately-stopped but spawn! was called " @spawn-count " time(s), entry=" (pr-str entry))))
    (when (not= entry (:entry result))
      (fail! (str "draw " i ": deliberately-stopped but the tracked entry changed - was " (pr-str entry)
                  ", now " (pr-str (:entry result)))))))

;; ── invariant-2 generators: entries directed at each reachable event ─────
(def i2-coverage (atom {:started 0 :crashed 0 :healthy-reset 0 :gave-up 0 :re-armed 0 :nil-event 0}))

(defn i2-entry+config []
  (let [kind (rand-nth* [:started :crashed :healthy-reset :gave-up :re-armed :nil-event])]
    (swap! i2-coverage update kind inc)
    (case kind
      :started
      {:entry (front-desk-supervisor-lib/default-entry) :now-ms 1000 :pid-alive-os false :expect :started}

      :crashed
      {:entry {:pid (+ 1 (rand-int* 9000)) :attempts 0 :status "running" :crashed-at-ms nil
               :started-at-ms 500 :gave-up-at-ms nil}
       :now-ms (+ 500 (rand-int* 5000)) :pid-alive-os false :expect :crashed}

      :healthy-reset
      (let [started-at (+ 500 (rand-int* 5000))]
        {:entry {:pid (+ 1 (rand-int* 9000)) :attempts (inc (rand-int* 4)) :status "running"
                 :crashed-at-ms nil :started-at-ms started-at :gave-up-at-ms nil}
         :now-ms (+ started-at (:healthy-reset-ms restart-config) 1 (rand-int* 1000))
         :pid-alive-os true :expect :healthy-reset})

      :gave-up
      (let [crashed-at (+ 500 (rand-int* 5000))]
        {:entry {:pid nil :attempts (:max-attempts restart-config) :status "waiting"
                 :crashed-at-ms crashed-at :started-at-ms nil :gave-up-at-ms nil}
         :now-ms (+ crashed-at (:backoff-max-ms restart-config) 1 (rand-int* 1000))
         :pid-alive-os false :expect :gave-up})

      :re-armed
      (let [gave-up-at (+ 500 (rand-int* 5000))]
        {:entry {:pid nil :attempts (:max-attempts restart-config) :status "gave-up"
                 :crashed-at-ms nil :started-at-ms nil :gave-up-at-ms gave-up-at}
         :now-ms (+ gave-up-at (:giveup-cooldown-ms giveup-config) 1 (rand-int* 1000))
         :pid-alive-os false :expect :re-armed})

      :nil-event
      (let [started-at (+ 500 (rand-int* 5000))]
        {:entry {:pid (+ 1 (rand-int* 9000)) :attempts 0 :status "running" :crashed-at-ms nil
                 :started-at-ms started-at :gave-up-at-ms nil}
         :now-ms (+ started-at (rand-int* (:healthy-reset-ms restart-config))) ;; still under the reset window
         :pid-alive-os true :expect nil}))))

(dotimes [i runs]
  (let [{:keys [entry now-ms pid-alive-os expect]} (i2-entry+config)
        result (operator-runtime-watch-lib/decide
                {:skip-env false :parked false :entry entry :now-ms now-ms
                 :pid-alive? (constantly pid-alive-os)
                 :spawn! (counting-spawn! (atom 0))
                 :restart-config restart-config :giveup-config giveup-config
                 :check-one-fn front-desk-supervisor-lib/check-one!})
        event (:event result)]
    (when (not= expect event)
      (fail! (str "draw " i ": directed at " expect " but check-one! produced " event
                  " for entry=" (pr-str entry) " now-ms=" now-ms)))
    ;; The behavior side is the REAL production composition (the supervisor's
    ;; announce-for-event! is a thin announce!-I/O wrapper around exactly this
    ;; call); the expectation side is invariant 2's own classification, kept
    ;; as an independent spec literal on purpose - deriving it from
    ;; announced-event? would re-create the copy-vs-copy vacuity the
    ;; 2026-08-21 bounce named.
    (let [restart-or-escalation? (contains? #{:started :re-armed :gave-up} event)
          text (operator-runtime-watch-lib/announcement-for-event event (:entry result))]
      (when (not= restart-or-escalation? (some? text))
        (fail! (str "draw " i ": event " event " - invariant 2 says announced=" restart-or-escalation?
                    " but announcement-for-event returned " (pr-str text))))
      (when (and restart-or-escalation? (str/blank? text))
        (fail! (str "draw " i ": event " event " - announced with blank text"))))))

;; ── coverage floors ────────────────────────────────────────────────────────
(doseq [[k floor] {:not-started 5 :waiting-due 5 :gave-up-cooldown-elapsed 5}]
  (when (< (get @i1-coverage k) floor)
    (fail! (str "generator coverage: invariant-1 " (name k) " reached only " (get @i1-coverage k) " of " runs " (floor " floor ")"))))
(doseq [[k floor] {:started 5 :crashed 5 :healthy-reset 5 :gave-up 5 :re-armed 5 :nil-event 5}]
  (when (< (get @i2-coverage k) floor)
    (fail! (str "generator coverage: invariant-2 " (name k) " reached only " (get @i2-coverage k) " of " runs " (floor " floor ")"))))

(println (str "  invariant-1 coverage: " (pr-str @i1-coverage)))
(println (str "  invariant-2 coverage: " (pr-str @i2-coverage)))
(if (empty? @failures)
  (do (println (str "bl993 operator-watch properties: " runs " draws x2 against the real decide/check-one!"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
