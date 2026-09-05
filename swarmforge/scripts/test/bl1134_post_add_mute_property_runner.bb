#!/usr/bin/env bb
;; BL-1134 property encoding (declared ticket invariants):
;;   I1 durable staged reversion with no in-flight signal still alarms (BL-839)
;;   I2 commit-in-flight? is read-only (lock and/or process observation; no writes)
;;   I3 mute is not sticky — after signal clears, same staged result alarms again
;;   I4 primary mute is observable in-flight (lock OR git add/commit argv for root),
;;      not blob-ancestry guessing
;;
;; Exercises check-master-checkout-drift! with injected commit-in-flight?* plus
;; the pure git-add-or-commit-argv-for-root? / two-arity commit-in-flight?.

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

(defn- run-check [{:keys [in-flight? staged?]}]
  (let [alarms (atom [])
        a-index* (if staged? a-index a-main)
        result
        (master-checkout-drift-lib/check-master-checkout-drift!
         {:project-root "/tmp/bl1134-prop-unused"
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
                          (= bare "a.bb") {:ok? true :content a-main}
                          :else {:ok? false :content nil}))})]
    {:result result :alarms @alarms}))

;; I1: durable staged reversion, no in-flight → still alarms.
(let [{:keys [result alarms]} (run-check {:in-flight? false :staged? true})]
  (when-not (= :drift (:overall result))
    (fail! "I1: overall must be :drift for durable staged reversion"))
  (when-not (some #{:staged-for-reversion} (vals (:per-file result)))
    (fail! "I1: per-file must include :staged-for-reversion"))
  (when (empty? alarms)
    (fail! "I1: durable staged reversion with no in-flight must alarm")))

;; Control: same staged shape while in-flight must not alarm.
(let [{:keys [alarms]} (run-check {:in-flight? true :staged? true})]
  (when (seq alarms)
    (fail! "control: staged-only while in-flight must mute")))

;; I3: after signal clears, same durable staged shape alarms again.
(let [_mute (run-check {:in-flight? true :staged? true})
      {:keys [alarms]} (run-check {:in-flight? false :staged? true})]
  (when (empty? alarms)
    (fail! "I3: after in-flight clears, staged reversion must alarm again")))

;; I4: argv classifier — foreign git commit must not count for this root;
;;     same-root git add/commit must; status must not.
(let [root "/tmp/bl1134-prop-root"]
  (when-not (master-checkout-drift-lib/git-add-or-commit-argv-for-root?
             (str "git -C " root " add foo.bb") root)
    (fail! "I4: git add for root must classify in-flight"))
  (when-not (master-checkout-drift-lib/git-add-or-commit-argv-for-root?
             (str "git -C " root " commit -m x") root)
    (fail! "I4: git commit for root must classify in-flight"))
  (when (master-checkout-drift-lib/git-add-or-commit-argv-for-root?
         "git -C /other/root commit -m x" root)
    (fail! "I4: foreign root git commit must not classify"))
  (when (master-checkout-drift-lib/git-add-or-commit-argv-for-root?
         (str "git -C " root " status") root)
    (fail! "I4: git status must not classify as add/commit"))
  (when-not (master-checkout-drift-lib/commit-in-flight?
             root [(str "git -C " root " add swarmforge/scripts/handoffd.bb")])
    (fail! "I4: two-arity commit-in-flight? must see post-add argv"))
  (when (master-checkout-drift-lib/commit-in-flight? root [])
    (fail! "I4: empty process table + no lock → not in flight")))

;; I2: read-only — lock observe and argv classify leave .git unchanged.
(let [tmp (str (fs/create-temp-dir {:prefix "bl1134-prop-"}))
      _ (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))
      git (fs/path tmp ".git")]
  (fs/create-dirs git)
  (let [before (set (map str (fs/list-dir git)))]
    (when (master-checkout-drift-lib/commit-in-flight? tmp [])
      (fail! "I2: no lock / no argv → not in flight"))
    (spit (str (fs/path git "index.lock")) "")
    (when-not (master-checkout-drift-lib/commit-in-flight? tmp [])
      (fail! "I2: lock present → in flight"))
    (fs/delete-if-exists (fs/path git "index.lock"))
    (master-checkout-drift-lib/commit-in-flight?
     tmp [(str "git -C " tmp " commit -m x")])
    (let [after (set (map str (fs/list-dir git)))]
      (when-not (= before after)
        (fail! "I2: in-flight detection must not leave extra files under .git")))))

(if (empty? @failures)
  (println "bl1134_post_add_mute_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1134_post_add_mute_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
