#!/usr/bin/env bb
;; BL-669 pure decision tests for outage-driven seat failover.
(def scripts-dir (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*)) ".."))
(load-file (str (babashka.fs/path scripts-dir "provider_outage_record_lib.bb")))
(load-file (str (babashka.fs/path scripts-dir "outage_failover_lib.bb")))
(load-file (str (babashka.fs/path scripts-dir "model_steward_lib.bb")))

(def threshold provider-outage-record-lib/default-sustained-threshold-ms)
(def now-ms (+ 1000000 (* 25 60 1000)))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (println "FAIL:" msg "expected" (pr-str expected) "got" (pr-str actual))
    (System/exit 1))
  (println "PASS:" msg))

(defn assert-true [msg v]
  (when-not v (println "FAIL:" msg) (System/exit 1))
  (println "PASS:" msg))

(def outage {:id "op-1" :provider "anthropic" :model "claude-opus-5"
             :affected-seats ["architect"] :started-at-ms 1000000})

(def young-outage (assoc outage :started-at-ms (- now-ms (* 5 60 1000))))

(def closed-outage (assoc outage :ended-at-utc "2026-07-26T10:00:00Z"))

(def registry
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "anthropic" "claude-opus-5"
                                        {:status "certified" :context_window 200000 :cost_class "high"})
      (model-steward-lib/register-model "anthropic" "claude-opus-4-8"
                                        {:status "certified" :context_window 200000 :cost_class "high"})
      (model-steward-lib/register-model "anthropic" "claude-sonnet-5"
                                        {:status "certified" :context_window 200000 :cost_class "medium"})
      (model-steward-lib/add-role-ranking "architect" "anthropic" "claude-opus-4-8" 0.94
                                          "BL-669:incumbent-architect-fallback")
      (model-steward-lib/add-role-ranking "architect" "anthropic" "claude-sonnet-5" 0.95
                                          "recruiter-scorecard:seed-architect-01")))

(assert-true "01: sustained outage crosses threshold"
             (provider-outage-record-lib/sustained? outage now-ms threshold))

(assert-true "01b: young outage below threshold is not sustained"
             (not (provider-outage-record-lib/sustained? young-outage now-ms threshold)))

(let [sub (outage-failover-lib/consult-steward-substitute registry "architect" outage)]
  (assert= "01c: steward picks opus-4-8 fallback" "claude-opus-4-8" (:model sub)))

(let [decision (outage-failover-lib/decide-failover-action
                {:records [outage] :seat "architect" :seat-idle? true :attended? false
                 :registry registry :active-swap {} :now-ms now-ms})]
  (assert= "02: idle boundary applies swap" :apply (:action decision)))

(let [decision (outage-failover-lib/decide-failover-action
                {:records [outage] :seat "architect" :seat-idle? false :attended? false
                 :registry registry :active-swap {} :now-ms now-ms})]
  (assert= "02b: mid-turn defers apply" :defer-apply (:action decision)))

(let [decision (outage-failover-lib/decide-failover-action
                {:records [young-outage] :seat "architect" :seat-idle? true :attended? false
                 :registry registry :active-swap {} :now-ms now-ms})]
  (assert= "01d: below threshold does not consult" :none (:action decision)))

(let [active {:architect {:outage-id "op-1" :from {:provider "anthropic" :model "claude-opus-5"}
                          :to {:provider "anthropic" :model "claude-opus-4-8"}}}
      decision (outage-failover-lib/decide-failover-action
                {:records [closed-outage] :seat "architect" :seat-idle? true :attended? false
                 :registry registry :active-swap active :now-ms now-ms})]
  (assert= "03: closed outage reverts at idle" :revert (:action decision)))

(let [uncert-registry (-> model-steward-lib/empty-registry
                          (model-steward-lib/register-model "anthropic" "claude-opus-5"
                                                            {:status "certified" :context_window 200000 :cost_class "high"})
                          (model-steward-lib/register-model "anthropic" "claude-opus-4-8"
                                                            {:status "candidate" :context_window 200000 :cost_class "high"})
                          (model-steward-lib/add-role-ranking "architect" "anthropic" "claude-opus-4-8" 0.94
                                                              "BL-669:incumbent-architect-fallback"))
      decision (outage-failover-lib/decide-failover-action
                {:records [outage] :seat "architect" :seat-idle? true :attended? false
                 :registry uncert-registry :active-swap {} :now-ms now-ms})]
  (assert= "04: uncertified substitute never applied" :none (:action decision)))

(println "ALL PASS")
