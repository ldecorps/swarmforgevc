#!/usr/bin/env bb
;; BL-669: pure outage-driven seat failover decisions. Consults Model Steward
;; read APIs only — never bypasses assignment-eligible? and never accepts
;; :override-uncertified on this path.
(ns outage-failover-lib
  (:require [clojure.string :as str]))

(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*)) "provider_outage_record_lib.bb")))
(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*)) "model_steward_lib.bb")))

(defn model-key [provider model]
  (str provider "/" model))

(defn certified-candidates [registry role]
  (->> (model-steward-lib/role-recommendations registry role)
       (filter #(model-steward-lib/assignment-eligible?
                 registry (:provider %) (:model %)
                 {:override-uncertified? false}))
       vec))

(defn fallback-tagged? [candidate]
  (str/includes? (or (:evidence candidate) "") "fallback"))

(defn pick-failover-substitute
  "Returns the top certified substitute for `role`, excluding the failed
   model. Same-provider designated fallbacks (evidence tagged) rank ahead of
   other same-provider candidates for model-scoped incidents."
  [registry role outage]
  (let [failed (model-key (:provider outage) (:model outage))
        survivors (->> (certified-candidates registry role)
                       (remove #(= failed (model-key (:provider %) (:model %))))
                       vec)
        same-provider (filter #(= (:provider %) (:provider outage)) survivors)
        tagged (filter fallback-tagged? same-provider)]
    (or (first tagged) (first same-provider) (first survivors))))

(defn consult-steward-substitute [registry role outage]
  (when outage
    (pick-failover-substitute registry role outage)))

(defn should-consult-steward?
  [records seat now-ms & [threshold-ms]]
  (boolean (seq (provider-outage-record-lib/sustained-for-seat records seat now-ms threshold-ms))))

(defn active-swap-for-seat [active-swap seat]
  (get active-swap (keyword seat)))

(defn swap-outage-id [swap]
  (or (:outage-id swap) (:outageId swap) (get swap "outage-id")))

(defn closed-outage? [records outage-id]
  (some #(and (= (:id %) outage-id) (some? (:ended-at-utc %)))
        (map provider-outage-record-lib/normalize-record records)))

(defn decide-failover-action
  [{:keys [records seat seat-idle? attended? registry active-swap now-ms threshold-ms]}]
  (let [threshold-ms (or threshold-ms provider-outage-record-lib/default-sustained-threshold-ms)
        sustained (first (provider-outage-record-lib/sustained-for-seat records seat now-ms threshold-ms))
        swap (active-swap-for-seat active-swap seat)]
    (cond
      (and swap (swap-outage-id swap) (closed-outage? records (swap-outage-id swap)))
      (if seat-idle? {:action :revert :swap swap} {:action :defer-revert :swap swap})

      swap {:action :none :reason :swap-already-active}

      (nil? sustained) {:action :none :reason :below-threshold-or-closed}

      :else
      (let [substitute (consult-steward-substitute registry seat sustained)]
        (cond
          (nil? substitute) {:action :none :reason :no-certified-substitute :outage sustained}
          attended? {:action :propose :outage sustained :substitute substitute}
          (not seat-idle?) {:action :defer-apply :outage sustained :substitute substitute}
          :else {:action :apply :outage sustained :substitute substitute})))))

(defn swap-announcement-text
  [{:keys [seat from to outage revert?]}]
  (let [verb (if revert? "revert" "swap")
        revert-note (if revert? "pack canonical restored" "reverts when outage endedAtUtc closes")]
    (str "OUTAGE-FAILOVER " verb " seat=" seat
         " from=" (model-key (:provider from) (:model from))
         " to=" (model-key (:provider to) (:model to))
         " incident=" (model-key (:provider outage) (:model outage))
         " " revert-note)))

(defn experiment-log-entry
  [{:keys [seat action from to outage revert? now-ms]}]
  {:ts-ms now-ms
   :kind (if (keyword? action) (name action) (str action))
   :seat seat
   :from from
   :to to
   :outage-id (:id outage)
   :revert (boolean revert?)})
