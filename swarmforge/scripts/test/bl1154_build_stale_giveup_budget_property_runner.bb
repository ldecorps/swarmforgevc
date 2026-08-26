#!/usr/bin/env bb
;; BL-1154 property invariants:
;; 1. Voluntary build-stale restarts never alone exhaust crash give-up budget.
;; 2. True crash loops still reach give-up within the configured cap.

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def alive? (constantly true))
(def dead? (constantly false))
(def spawn! (constantly 4242))
(def cfg {:max-attempts 3 :backoff-base-ms 10 :backoff-max-ms 10 :healthy-reset-ms 600000 :build-grace-ms 1000})
(def giveup {:giveup-cooldown-ms 900000})

(defn simulate-build-stale-cycle [entry cycle-now]
  (let [detected (front-desk-supervisor-lib/check-one!
                   entry cycle-now alive? spawn! cfg giveup false (fn [_] nil) true true)
        entry (:entry detected)
        past-grace (+ cycle-now 1001)
        {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                entry past-grace alive? spawn! cfg giveup false (fn [_] nil) true true)]
    (assert= "P1: build-stale fires before voluntary restart" :build-stale event)
    (assert= "P1: attempts untouched entering stale-build queue" 0 (:attempts entry))
    (let [backoff (+ past-grace (front-desk-supervisor-lib/compute-backoff-ms 1 cfg))
          {:keys [entry event]} (front-desk-supervisor-lib/check-one!
                                  entry backoff alive? spawn! cfg giveup)]
      (assert= "P1: voluntary restart returns to running" "running" (:status entry))
      (assert= "P1: voluntary restart emits :started" :started event)
      (assert= "P1: attempts unchanged after voluntary restart" 0 (:attempts entry))
      entry)))

;; Invariant 1: many voluntary build-stale rolls, budget never exhausted.
(let [entry (reduce (fn [e i] (simulate-build-stale-cycle e (+ 10000 (* i 5000))))
                    {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 1
                     :gave-up-at-ms nil :build-stale-since-ms nil}
                    (range 8))]
  (assert= "P1: still running after many build-stale cycles" "running" (:status entry))
  (assert= "P1: crash budget still zero" 0 (:attempts entry)))

;; Invariant 2: crash loop at cap still gives up.
(let [{:keys [entry event]} (front-desk-supervisor-lib/check-one!
                             {:pid nil :attempts 3 :status "waiting" :crashed-at-ms 100 :started-at-ms 1 :gave-up-at-ms nil}
                             999 dead? spawn! cfg giveup)]
  (assert= "P2: crash loop reaches gave-up at cap" "gave-up" (:status entry))
  (assert= "P2: gave-up event reported" :gave-up event))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (do
    (println "P1: voluntary build-stale never alone exhausts crash budget")
    (println "P2: crash loop reaches gave-up at cap")
    (println "bl1154_build_stale_giveup_budget_property_runner: ALL TESTS PASSED")))
