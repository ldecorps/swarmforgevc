#!/usr/bin/env bb
;; BL-1151 property: armed escalation survives cooldown re-arm without
;; healthy grace; healthy grace disarms for a new episode.

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def armed-delivered {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil})
(def retry-cfg {:max-attempts 3 :backoff-base-ms 1 :backoff-max-ms 1})

(assert-true "P1: re-arm without healthy grace keeps armed"
             (:armed? (operator-lib/give-up-escalation-alarm-when-not-gave-up armed-delivered false)))
(assert-false "P1: armed state suppresses another send attempt"
              (operator-lib/starvation-alarm-should-attempt?
               {:starving? true :armed? true :delivery-attempts 0 :last-attempt-at-ms nil
                :now-ms 999999 :retry-config retry-cfg}))

(assert-false "P2: healthy grace disarms after a delivered episode"
              (:armed? (operator-lib/give-up-escalation-alarm-when-not-gave-up armed-delivered true)))
(assert-true "P2: disarmed state allows a fresh send on the next give-up"
             (operator-lib/starvation-alarm-should-attempt?
              {:starving? true :armed? false :delivery-attempts 0 :last-attempt-at-ms nil
               :now-ms 999999 :retry-config retry-cfg}))

;; Simulate two give-up cycles without healthy grace: arm once, stay armed.
(let [after-rearm (operator-lib/give-up-escalation-alarm-when-not-gave-up armed-delivered false)]
  (assert-true "P3: episode loop keeps armed across synthetic re-arm" (:armed? after-rearm))
  (assert-false "P3: second give-up tick still must not re-email"
                (operator-lib/starvation-alarm-should-attempt?
                 {:starving? true :armed? (:armed? after-rearm)
                  :delivery-attempts (:delivery-attempts after-rearm)
                  :last-attempt-at-ms (:last-attempt-at-ms after-rearm)
                  :now-ms 1000000 :retry-config retry-cfg})))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "bl1151_giveup_escalation_alarm_property_runner: ALL TESTS PASSED"))
