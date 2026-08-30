#!/usr/bin/env bb
;; BL-1224's three declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over operator_runtime_watch_lib.bb's own decide/adoptable-pid.
;;
;; In the Babashka lane because that is where the decision lives. Deterministic
;; by construction: a seeded LCG, never rand - a property that flakes is worse
;; than none, and a counterexample nobody can reproduce is not one.
;;
;; GENERATOR REACH, stated because it is what decides whether these prove
;; anything. The interesting space is tiny and adversarial, so it is drawn
;; directly rather than sampled from a wide one:
;;   - the pidfile is drawn from the FOUR states that exist (names a different
;;     live runtime, names the dead tracked pid, absent, names a live unrelated
;;     process), each floored. A random integer pidfile would produce the
;;     adoption case - the only one that changes behaviour - almost never;
;;   - tracked-alive is drawn too, because "the tracked pid is still alive" is
;;     the case where nothing should happen at all and it is easy to break;
;;   - the attempt count is drawn across the give-up boundary, so an adoption
;;     is checked to spend nothing whether the budget is fresh or nearly gone.
;;
;; Non-vacuity is proven by breaking each invariant and recording the result -
;; see backlog/evidence/BL-1224-watch-adoption-20260830.md.

(ns bl1224-watch-adoption-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_runtime_watch_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

(def tracked-pid 1001)
(def other-pid 2002)

;; The four pidfile states that exist, named so a failure says which one.
(def pidfile-states
  [:different-live-runtime   ;; a deliberate restart: adopt
   :same-dead-pid            ;; a real crash
   :absent                   ;; a real crash
   :live-unrelated])         ;; pid reuse: a real crash

(defn gen-case [s]
  (let [[state s0] (gen-pick s pidfile-states)
        [tracked-alive s1] (gen-int s0 2)
        [attempts s2] (gen-int s1 7)]
    [{:state state :tracked-alive (= 1 tracked-alive) :attempts attempts} s2]))

(defn- scenario [{:keys [state tracked-alive]}]
  (case state
    :different-live-runtime {:pidfile-pid other-pid :live (cond-> #{other-pid} tracked-alive (conj tracked-pid))}
    :same-dead-pid {:pidfile-pid tracked-pid :live (if tracked-alive #{tracked-pid} #{})}
    :absent {:pidfile-pid nil :live (if tracked-alive #{tracked-pid} #{})}
    ;; alive? is the cmdline-checked predicate, so an unrelated live process is
    ;; simply not alive by it - the pidfile names a pid nothing here accepts.
    :live-unrelated {:pidfile-pid other-pid :live (if tracked-alive #{tracked-pid} #{})}))

(defn- run-decide [{:keys [state tracked-alive attempts] :as input}]
  (let [{:keys [pidfile-pid live]} (scenario input)
        spawned (atom 0)
        reached (atom 0)
        alive? (fn [pid] (boolean (and pid (contains? live pid))))
        check-one (fn [entry _now _a spawn! _rc _gc]
                    (swap! reached inc)
                    (spawn!)
                    {:entry (assoc entry :attempts (inc (:attempts entry)) :status "running") :event :started})
        out (operator-runtime-watch-lib/decide
             {:skip-env false :parked false
              :entry {:pid tracked-pid :attempts attempts :status "running"}
              :now-ms 5000
              :pid-alive? alive?
              :spawn! (fn [] (swap! spawned inc) other-pid)
              :restart-config {:max-attempts 5 :backoff-base-ms 1 :backoff-max-ms 10 :healthy-reset-ms 600000}
              :giveup-config {:giveup-cooldown-ms 900000}
              :check-one-fn check-one
              :pidfile-pid pidfile-pid})]
    (cover! state)
    (cover! (if tracked-alive :tracked-alive :tracked-dead))
    (when (>= attempts 5) (cover! :budget-spent))
    (assoc out :spawned @spawned :reached @reached :input input)))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "A vanished tracked pid is counted as a crash unless the pidfile names a
;;  different, live operator_runtime.bb process."

(check-all
 "P1: an adoption happens exactly when the pidfile names a different live runtime"
 gen-case
 (fn [{:keys [state tracked-alive] :as input}]
   (let [{:keys [event]} (run-decide input)
         should-adopt (and (not tracked-alive) (= state :different-live-runtime))]
     (cond
       (and should-adopt (not= :adopted event))
       (str "a deliberate restart was not adopted: " event)

       (and (not should-adopt) (= :adopted event))
       (str "an adoption masked a crash (" (name state)
            ", tracked " (if tracked-alive "alive" "dead") ")")

       :else true))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "An adoption never starts a process and never consumes a restart attempt."
;;
;; Checked as a consequence AND as its cause: the restart state machine is the
;; only thing that spawns or counts, so an adoption that never reaches it
;; cannot do either - asserting only the counters would pass against a fix that
;; reached the machine and then undid the damage.

(check-all
 "P2: an adoption starts nothing, spends nothing, and never reaches the restart machine"
 gen-case
 (fn [{:keys [attempts] :as input}]
   (let [{:keys [event entry spawned reached]} (run-decide input)]
     (if-not (= :adopted event)
       true
       (cond
         (pos? spawned) (str "an adoption started " spawned " process(es)")
         (pos? reached) "an adoption reached the restart state machine"
         (not= attempts (:attempts entry)) (str "an adoption moved the attempt count " attempts " -> " (:attempts entry))
         (not= other-pid (:pid entry)) (str "an adoption did not follow the new pid: " (:pid entry))
         (not= "running" (:status entry)) (str "an adopted runtime is not running: " (:status entry))
         (some? (:crashed-at-ms entry)) "an adoption left a crash mark behind"
         :else true)))))

;; ── invariant 3 ───────────────────────────────────────────────────────────
;; "Every adoption is visible in the watch's own log and status file."
;;
;; The lib half is what this lane can hold: the event must be a real one the
;; supervisor can dispatch on, and must NOT be announced to the human. That the
;; supervisor's log arm exists is asserted by the acceptance against its source,
;; and the end-to-end log/status write by
;; test_operator_runtime_watch_adoption.sh.

(check-all
 "P3: an adoption is a recordable event that never reaches the human channel"
 gen-case
 (fn [input]
   (let [{:keys [event entry]} (run-decide input)]
     (if-not (= :adopted event)
       true
       (cond
         (operator-runtime-watch-lib/announced-event? event)
         "an adoption reached the human channel"

         (some? (operator-runtime-watch-lib/announcement-for-event event entry))
         "an adoption produced announcement text"

         ;; ...and it carries what a log line needs to be worth reading.
         (nil? (:pid entry)) "an adoption named no pid to log"
         :else true)))))

(def floors {:different-live-runtime 60 :same-dead-pid 60 :absent 60 :live-unrelated 60
             :tracked-alive 120 :tracked-dead 120 :budget-spent 60})

(doseq [[k floor] floors]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
