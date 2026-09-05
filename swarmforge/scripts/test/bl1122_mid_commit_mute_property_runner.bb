#!/usr/bin/env bb
;; BL-1122 property encoding (architect rematch):
;;   I1 durable :staged-for-reversion with in-flight? false still alarms
;;   I2 commit-in-flight? / mute path is read-only (no git write side effects)
;;   I3 mute is not sticky — after lock clears, same staged result alarms again
;;
;; Exercises check-master-checkout-drift! with injected commit-in-flight?* and
;; emit-alarm! (BL-839 / APS injection shape), plus real index.lock observation.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "master_checkout_drift_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(def handoffd-src "(load-file \"a.bb\")\n")
(def a-main "(defn foo [] :main)\n")
(def a-index "(defn foo [] :index)\n")

(defn- content-for [spec a-index*]
  (cond
    (str/ends-with? (str spec) "handoffd.bb") handoffd-src
    (str/ends-with? (str spec) "a.bb")
    (cond
      (str/starts-with? (str spec) "main:") a-main
      (str/starts-with? (str spec) ":") a-index*
      :else a-main)
    :else nil))

(defn- run-check [{:keys [in-flight? staged? worktree]}]
  (let [alarms (atom [])
        a-index* (if staged? a-index a-main)
        a-work* (or worktree a-main)
        result
        (master-checkout-drift-lib/check-master-checkout-drift!
         {:project-root "/tmp/bl1122-prop-unused"
          :entrypoints #{"handoffd.bb"}
          :emit-alarm! (fn [t] (swap! alarms conj t))
          :commit-in-flight?* (fn [_] (boolean in-flight?))
          :run-git* (fn [_root args]
                      (cond
                        (= args ["rev-parse" "--verify" "main"]) {:ok? true :content "ok"}
                        (= (first args) "show")
                        (let [c (content-for (second args) a-index*)]
                          (if c {:ok? true :content c} {:ok? false :content nil}))
                        :else {:ok? false :content nil}))
          :read-disk* (fn [_ _ bare]
                        (cond
                          (= bare "handoffd.bb") {:ok? true :content handoffd-src}
                          (= bare "a.bb") {:ok? true :content a-work*}
                          :else {:ok? false :content nil}))})]
    {:result result :alarms @alarms}))

;; I1: durable staged reversion, no in-flight → still alarms (BL-839 preserved).
(let [{:keys [result alarms]} (run-check {:in-flight? false :staged? true})]
  (when-not (= :drift (:overall result))
    (fail! "I1: overall must be :drift for durable staged reversion"))
  (when-not (some #{:staged-for-reversion} (vals (:per-file result)))
    (fail! "I1: per-file must include :staged-for-reversion"))
  (when (empty? alarms)
    (fail! "I1: durable staged reversion with no in-flight must alarm")))

;; Mute while in-flight (control): same staged shape must not alarm.
(let [{:keys [alarms]} (run-check {:in-flight? true :staged? true})]
  (when (seq alarms)
    (fail! "control: staged-only while in-flight must mute")))

;; I3: after in-flight clears, same durable staged shape alarms again (not sticky).
(let [_mute (run-check {:in-flight? true :staged? true})
      {:keys [alarms]} (run-check {:in-flight? false :staged? true})]
  (when (empty? alarms)
    (fail! "I3: after in-flight clears, staged reversion must alarm again")))

;; Uncommitted-edit must still alarm while in-flight (mute scoped to staged-only).
;; classify-drift: index==main and worktree!=main → :uncommitted-edit.
(let [{:keys [alarms]} (run-check {:in-flight? true
                                   :staged? false
                                   :worktree "(defn foo [] :work)\n"})]
  (when (empty? alarms)
    (fail! "uncommitted-edit must still alarm while in-flight")))

;; I2: commit-in-flight? is read-only — observes lock only; no leftover files.
(let [tmp (str (fs/create-temp-dir {:prefix "bl1122-prop-"}))
      _ (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))
      git (fs/path tmp ".git")]
  (fs/create-dirs git)
  (let [before (set (map str (fs/list-dir git)))]
    (when (master-checkout-drift-lib/commit-in-flight? tmp)
      (fail! "I2: no lock → not in flight"))
    (spit (str (fs/path git "index.lock")) "")
    (when-not (master-checkout-drift-lib/commit-in-flight? tmp)
      (fail! "I2: lock present → in flight"))
    ;; Calling check with real commit-in-flight? must not write outside lock observe.
    (let [alarms (atom [])]
      (master-checkout-drift-lib/check-master-checkout-drift!
       {:project-root tmp
        :entrypoints #{"handoffd.bb"}
        :emit-alarm! (fn [t] (swap! alarms conj t))
        :run-git* (fn [_ _] {:ok? false :content nil})
        :read-disk* (fn [_ _ _] {:ok? false :content nil})}))
    (fs/delete-if-exists (fs/path git "index.lock"))
    (when (master-checkout-drift-lib/commit-in-flight? tmp)
      (fail! "I2: lock removed → not sticky"))
    (let [after (set (map str (fs/list-dir git)))]
      (when-not (= before after)
        (fail! "I2: mute/check path must not leave extra files under .git")))))

(if (empty? @failures)
  (println "bl1122_mid_commit_mute_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1122_mid_commit_mute_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
