#!/usr/bin/env bb
;; BL-1037 property test (coder-authored, two DECLARED invariants) over
;; front_desk_supervisor_lib.bb's check-one! build-freshness path.
;;
;;   Invariant 1: "Staleness deferred is never staleness dropped: a commit the
;;   watchdog declines to restart for now is still owed a restart later."
;;
;;   Invariant 2: "A restart is never triggered against a child that has not
;;   yet completed a poll cycle on the build it was restarted onto."
;;
;; Invariant 1 is why this is a property and not a scenario, and the ticket
;; says so: deferral is only legitimate if the DEBT SURVIVES it. A fix that
;; reduced restarts by forgetting a staleness it had already seen would satisfy
;; every rate-limiting scenario while reintroducing the 2h23m stale-serving
;; window BL-582 exists to close. So each run replays a whole tick sequence and
;; asserts the debt is still owed at every deferral, and is eventually PAID.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The interesting state is PAST THE GRACE AND NOT YET SERVED - the deferral.
;; Drawing "served" independently per tick makes a long un-served run rare, and
;; a generator that mostly serves would exercise only BL-582's original path
;; and pass against the unfixed code. Runs therefore CONSTRUCT an un-served
;; stretch of generated length after each restart, with a floor asserting
;; deferrals were actually reached.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1037, 300 runs):
;;   - the deferral DROPS the debt ............... P1 1126
;;   - ignore build-served? (BL-582 unbounded) ... P2 852, +1 coverage floor
;;   - defer forever, never restart .............. 2 coverage floors ONLY
;;
;; That last row is the one to read. Deferring forever satisfies BOTH declared
;; invariants completely - nothing is ever restarted un-served, and no debt is
;; ever dropped - while reinstating the exact 2h23m stale-serving window BL-582
;; exists to close. No property catches it; only the `:restarted` and
;; `:debt-paid` coverage floors do. They are assertions here, not diagnostics,
;; and this break is why.

(ns bl1037-build-restart-rate-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "front_desk_supervisor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))
(def coverage (atom {:deferred 0 :restarted 0 :fresh 0 :debt-paid 0 :never-stale 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def grace-ms 300000)
(def cfg {:backoff-base-ms 1000 :backoff-max-ms 1000 :max-attempts 5 :build-grace-ms grace-ms})
(def giveup {:giveup-cooldown-ms 900000})
(def alive? (constantly true))
(def spawn! (constantly 4242))

;; One generated run, replayed tick by tick. Returns its own stats so the outer
;; loop never has to recur across a nested loop boundary.
(defn- replay-run [seed ticks unserved always-stale?]
  (let [tick-ms 100000]
    (loop [t 0
           entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil
                  :started-at-ms 0 :gave-up-at-ms nil}
           now 100000
           since-restart 0
           restarts 0
           deferrals 0
           prev-debt nil]
      (if (>= t ticks)
        {:restarts restarts :deferrals deferrals}
        (let [served? (>= since-restart unserved)
              {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                      entry now alive? spawn! cfg giveup
                                      false (fn [_] nil) always-stale? served?)
              debt (:build-stale-since-ms entry)]

          ;; ── P1 (invariant 1): a deferral NEVER drops the debt.
          (when (= event :build-stale-deferred)
            (when (nil? debt)
              (report! "P1 (invariant 1: a deferred staleness is still owed)" seed
                       {:tick t :unserved unserved}
                       "the deferral cleared build-stale-since-ms - the debt was dropped"))
            (when (and prev-debt (not= prev-debt debt))
              (report! "P1 (invariant 1: a deferral never re-stamps the clock either)" seed
                       {:tick t :prev prev-debt :now debt}
                       "re-stamping would let an indefinitely-deferred child never come due")))

          ;; ── P2 (invariant 2): never restart a child that has not served.
          (when (and (= event :build-stale) (not served?))
            (report! "P2 (invariant 2: no restart before the child has served its build)" seed
                     {:tick t :unserved unserved :since-restart since-restart}
                     "restarted a child that had not completed a poll cycle"))

          (when (= event :build-stale) (swap! coverage update :debt-paid inc))

          (recur (inc t)
                 (if (= event :build-stale)
                   (assoc entry :status "running" :started-at-ms now :build-stale-since-ms nil)
                   entry)
                 (+ now tick-ms)
                 (if (= event :build-stale) 0 (inc since-restart))
                 (+ restarts (if (= event :build-stale) 1 0))
                 (+ deferrals (if (= event :build-stale-deferred) 1 0))
                 debt))))))

(loop [i 0 s 1037]
  (when (< i runs)
    (let [[nticks s1] (gen-int s 8)
          ticks (+ 14 nticks)
          ;; A CONSTRUCTED un-served stretch, so the deferral state is reached
          ;; by design. Capped below the tick count so every run can still pay
          ;; its debt - a generator that never lets the debt come due would
          ;; make P3's floor unreachable and hide a defer-forever fix.
          [unserved-raw s2] (gen-int s1 6)
          ;; Sized to OUTLAST the grace. The first version drew 0-3 ticks while
          ;; the grace elapses ~4 ticks after detection (300000ms / 100000ms per
          ;; tick), so the child had always served before a restart could fire and
          ;; the deferral state was unreachable BY CONSTRUCTION - 0 of 300 runs.
          ;; The coverage floor caught it: the properties were "holding" over a
          ;; state space that excluded the entire defect.
          unserved (+ 5 unserved-raw)
          [stale-mode s3] (gen-int s2 4)
          always-stale? (not (zero? stale-mode))
          {:keys [restarts deferrals]} (replay-run s ticks unserved always-stale?)]
      (swap! coverage update :deferred + deferrals)
      (swap! coverage update :restarted + restarts)
      (when-not always-stale? (swap! coverage update :never-stale inc))

      ;; ── P3 (the rate bound, scenario 02): a burst costs fewer restarts than
      ;; ticks. Without a bound the watchdog restarts on every tick past the
      ;; grace, which is the 12-respawns-in-105-minutes behaviour.
      (when (and always-stale? (pos? unserved) (>= restarts ticks))
        (report! "P3 (a burst costs fewer restarts than commits)" s
                 {:ticks ticks :unserved unserved :restarts restarts}
                 "restarted on every tick - the bound did nothing"))
      (recur (inc i) s3))))

(doseq [[k floor] {:deferred 150 :restarted 150 :debt-paid 150 :never-stale 40}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1037 build-restart-rate properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
