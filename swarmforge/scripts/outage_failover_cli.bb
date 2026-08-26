#!/usr/bin/env bb
;; BL-669: CLI + coordinator sweep entry for outage-driven seat failover.
(ns outage-failover-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "provider_outage_record_lib.bb")))
(load-file (str (fs/path scripts-dir "outage_failover_lib.bb")))
(load-file (str (fs/path scripts-dir "outage_failover_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_store.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn project-root []
  (or (System/getenv "OUTAGE_FAILOVER_PROJECT_ROOT")
      (outage-failover-store/repo-root)))

(defn steward-state-dir []
  (or (System/getenv "MODEL_STEWARD_STATE_DIR")
      (str (fs/path (project-root) model-steward-store/default-state-dir-rel))))

(defn factory-state-dir []
  (or (System/getenv "MODEL_FACTORY_STATE_DIR")
      (str (fs/path (project-root) model-factory-store/default-state-dir-rel))))

(defn failover-state-dir []
  (or (System/getenv "OUTAGE_FAILOVER_STATE_DIR")
      (outage-failover-store/state-dir (project-root))))

(defn load-steward-registry []
  (model-steward-store/read-registry! (steward-state-dir) model-steward-lib/seed-data->registry))

(defn opt-value [args k]
  (let [args (vec args) idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args))) (nth args (inc idx)))))

(defn has-flag? [args k] (boolean (some #(= k %) args)))

(defn now-ms [] (long (or (some-> (System/getenv "OUTAGE_FAILOVER_NOW_MS") parse-long)
                          (System/currentTimeMillis))))

(defn attended? []
  (= "1" (or (System/getenv "OUTAGE_FAILOVER_ATTENDED") "0")))

(defn seat-idle? [seat-idle-flag]
  (not= false seat-idle-flag))

(defn build-assignment-entry [role substitute reason]
  (let [{:keys [provider model]} substitute
        {:keys [agent known? reason agent-reason]} (model-factory-lib/resolve-launch-agent provider)
        err (or agent-reason reason)]
    (when-not known?
      (throw (ex-info (str err) {:role role :provider provider :model model})))
    {:role role :agent agent :provider provider :model model :policy "failover" :reason reason}))

(defn persist-swap! [seat swap-map]
  (let [active (outage-failover-store/read-active-swap! (failover-state-dir))]
    (outage-failover-store/write-active-swap! (failover-state-dir)
                                              (assoc active (keyword seat) swap-map))))

(defn clear-swap! [seat]
  (let [active (outage-failover-store/read-active-swap! (failover-state-dir))]
    (outage-failover-store/write-active-swap! (failover-state-dir)
                                              (dissoc active (keyword seat)))))

(defn announce-and-log! [payload]
  (let [text (outage-failover-lib/swap-announcement-text payload)
        entry (outage-failover-lib/experiment-log-entry payload)]
    (outage-failover-store/announce-operator! (project-root) text)
    (outage-failover-store/append-experiment-log! (project-root) entry)
    {:announcement text :experiment entry}))

(defn apply-seat-swap! [seat outage substitute canonical & [socket]]
  (let [entry (build-assignment-entry seat substitute "outage failover certified substitute")
        overlay (or (model-factory-store/read-assignment-overlay! (factory-state-dir)) {})
        merged (outage-failover-store/merge-seat-overlay! overlay seat entry)]
    (model-factory-store/write-assignment-overlay! (factory-state-dir) merged)
    (persist-swap! seat {:seat seat
                         :from canonical
                         :to {:provider (:provider substitute) :model (:model substitute)}
                         :outage-id (:id outage)
                         :applied-at-ms (now-ms)})
    (announce-and-log! {:seat seat :action :apply
                        :from canonical
                        :to {:provider (:provider substitute) :model (:model substitute)}
                        :outage outage :revert? false :now-ms (now-ms)})
    (when socket (outage-failover-store/respawn-seat! (project-root) seat socket))
    {:applied true :seat seat :substitute substitute}))

(defn revert-seat-swap! [seat swap & [socket]]
  (let [canonical (:from swap)
        entry (build-assignment-entry seat canonical "outage failover revert to pack canonical")
        overlay (or (model-factory-store/read-assignment-overlay! (factory-state-dir)) {})
        merged (outage-failover-store/merge-seat-overlay! overlay seat entry)]
    (model-factory-store/write-assignment-overlay! (factory-state-dir) merged)
    (clear-swap! seat)
    (announce-and-log! {:seat seat :action :revert
                        :from (:to swap) :to canonical
                        :outage {:id (:outage-id swap)} :revert? true :now-ms (now-ms)})
    (when socket (outage-failover-store/respawn-seat! (project-root) seat socket))
    {:reverted true :seat seat}))

(defn canonical-for-outage [outage]
  {:provider (:provider outage) :model (:model outage)})

(defn evaluate-seat [seat & {:keys [mid-turn? attended?]}]
  (outage-failover-lib/decide-failover-action
   {:records (outage-failover-store/read-outage-records! (project-root))
    :seat seat
    :seat-idle? (not mid-turn?)
    :attended? (boolean attended?)
    :registry (load-steward-registry)
    :active-swap (outage-failover-store/read-active-swap! (failover-state-dir))
    :now-ms (now-ms)
    :threshold-ms provider-outage-record-lib/default-sustained-threshold-ms}))

(defn run-evaluate [args]
  (let [seat (or (opt-value args "--seat") "architect")
        decision (evaluate-seat seat {:mid-turn? (has-flag? args "--mid-turn")
                                      :attended? (attended?)})]
    (println (json/generate-string decision))
    decision))

(defn register-opus-fallback! []
  (let [registry (load-steward-registry)
        updated (-> registry
                    (model-steward-lib/register-model "anthropic" "claude-opus-4-8"
                                                        {:status model-steward-lib/certified-status
                                                         :context_window 200000
                                                         :cost_class "high"
                                                         :known_limitations ["Same-provider fallback for opus-class outages (BL-669)"]})
                    (model-steward-lib/add-role-ranking "architect" "anthropic" "claude-opus-4-8" 0.94
                                                        "BL-669:incumbent-architect-fallback")
                    (model-steward-lib/set-capability-entry "anthropic" "claude-opus-4-8"
                                                            {"coding_quality" {:score 0.93}
                                                             "protocol_compliance" {:score 0.95}}))]
    (model-steward-store/write-registry! (steward-state-dir) updated)
    (println "registered anthropic/claude-opus-4-8 certified architect fallback")))

(defn run-register-opus-fallback [_]
  (register-opus-fallback!))

(defn outage-driven-seat-failover!
  "Coordinator sweep: evaluate every seat named in open outage records."
  [project-root roles socket & {:keys [seat-idle-fn attended?]}]
  (let [records (outage-failover-store/read-outage-records! project-root)
        seats (->> records
                   (mapcat #(or (:affected-seats %) (:affectedSeats %)))
                   distinct)
        seat-idle-fn (or seat-idle-fn (constantly true))
        attended? (if (nil? attended?) (attended?) attended?)]
    (doseq [seat seats]
      (let [decision (outage-failover-lib/decide-failover-action
                      {:records records :seat seat
                       :seat-idle? (seat-idle-fn seat)
                       :attended? attended?
                       :registry (load-steward-registry)
                       :active-swap (outage-failover-store/read-active-swap! (failover-state-dir))
                       :now-ms (now-ms)})
            action (:action decision)]
        (case action
          :apply (apply-seat-swap! seat (:outage decision) (:substitute decision)
                                   (canonical-for-outage (:outage decision)) socket)
          :revert (revert-seat-swap! seat (:swap decision) socket)
          :propose (outage-failover-store/announce-operator!
                    project-root
                    (str "OUTAGE-FAILOVER propose seat=" seat
                         " substitute=" (:provider (:substitute decision)) "/"
                         (:model (:substitute decision))
                         " — confirm to apply (attended hours)"))
          nil)))))

(defn run-apply-if-idle [args]
  (let [seat (or (opt-value args "--seat") "architect")
        decision (evaluate-seat seat {:mid-turn? false :attended? (attended?)})]
    (when (= :apply (:action decision))
      (apply-seat-swap! seat (:outage decision) (:substitute decision)
                        (canonical-for-outage (:outage decision))))
    (println (json/generate-string decision))
    decision))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: outage_failover_cli.bb evaluate [--seat ROLE] [--mid-turn]"))
  (println "       outage_failover_cli.bb apply-if-idle [--seat ROLE]")
  (println "       outage_failover_cli.bb register-opus-fallback")
  (System/exit 1))

(defn -main []
  (let [[cmd & rest-args] (or (seq (cli-args)) ['_])]
    (case cmd
      "evaluate" (run-evaluate rest-args)
      "apply-if-idle" (run-apply-if-idle rest-args)
      "register-opus-fallback" (run-register-opus-fallback rest-args)
      (usage))))

;; BL-669: only invoke as bb entrypoint — never when load-file'd from handoffd.
(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
