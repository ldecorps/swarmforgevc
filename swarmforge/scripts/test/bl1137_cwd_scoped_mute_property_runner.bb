#!/usr/bin/env bb
;; BL-1137 property encoding (declared mute invariants encoded /
;; declared ticket invariants):
;;   I1 durable staged reversion with no in-flight signal still alarms (BL-839)
;;   I2 commit-in-flight? is read-only (lock and/or process observation; no writes)
;;   I3 plain git add/commit with cwd at this root counts as in-flight (BL-1134
;;      argv-only root match is insufficient)
;;   I4 do not guess forward vs reversion from blob ancestry as the primary mute
;;
;; Exercises pure git-add-or-commit-process-for-root? / two-arity
;; commit-in-flight? with cwd snapshots, plus injected check mute behaviour.

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
         {:project-root "/tmp/bl1137-prop-unused"
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

;; I1: durable staged reversion, no in-flight → still alarms (BL-839).
(let [{:keys [result alarms]} (run-check {:in-flight? false :staged? true})]
  (when-not (= :drift (:overall result))
    (fail! "I1: overall must be :drift for durable staged reversion"))
  (when-not (some #{:staged-for-reversion} (vals (:per-file result)))
    (fail! "I1: per-file must include :staged-for-reversion"))
  (when (empty? alarms)
    (fail! "I1: durable staged reversion with no in-flight must alarm")))

;; I3: cwd-scoped plain git add/commit at this root counts; foreign cwd does not.
(let [root "/tmp/bl1137-prop-root"]
  (when-not (master-checkout-drift-lib/git-add-or-commit-process-for-root?
             {:cmdline "git add handoffd.bb" :cwd root} root)
    (fail! "I3: cwd-scoped git add must classify in-flight"))
  (when-not (master-checkout-drift-lib/git-add-or-commit-process-for-root?
             {:cmdline "git commit -m x" :cwd root} root)
    (fail! "I3: cwd-scoped git commit must classify in-flight"))
  (when (master-checkout-drift-lib/git-add-or-commit-process-for-root?
         {:cmdline "git commit -m x" :cwd "/other/root"} root)
    (fail! "I3: foreign-cwd git commit must not classify"))
  (when (master-checkout-drift-lib/git-add-or-commit-argv-for-root?
         "git commit -m x" root)
    (fail! "I3: argv-only classifier must still miss plain git commit (BL-1134 gap)"))
  (when-not (master-checkout-drift-lib/commit-in-flight?
             root [{:cmdline "git commit -m x" :cwd root}])
    (fail! "I3: two-arity commit-in-flight? must see cwd-scoped commit"))
  (when (master-checkout-drift-lib/commit-in-flight?
         root [{:cmdline "git commit -m x" :cwd "/other/root"}])
    (fail! "I3: foreign-cwd snapshot must not mute")))

;; Control: staged-only while in-flight must not alarm.
(let [{:keys [alarms]} (run-check {:in-flight? true :staged? true})]
  (when (seq alarms)
    (fail! "control: staged-only while in-flight must mute")))

;; I4: primary mute is observable in-flight (cwd/lock/argv), not ancestry.
(let [root "/tmp/bl1137-prop-root"]
  (when-not (master-checkout-drift-lib/commit-in-flight?
             root ["git -C /tmp/bl1137-prop-root commit -m x"])
    (fail! "I4: git -C this-root must still mute (argv path)"))
  (when (master-checkout-drift-lib/commit-in-flight? root [])
    (fail! "I4: empty snapshots + no lock → not in flight")))

;; I2: read-only — lock observe and cwd classify leave .git unchanged.
(let [tmp (str (fs/create-temp-dir {:prefix "bl1137-prop-"}))
      _ (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))
      git (fs/path tmp ".git")]
  (fs/create-dirs git)
  (let [before (set (map str (fs/list-dir git)))]
    (when (master-checkout-drift-lib/commit-in-flight? tmp [])
      (fail! "I2: no lock / no process → not in flight"))
    (spit (str (fs/path git "index.lock")) "")
    (when-not (master-checkout-drift-lib/commit-in-flight? tmp [])
      (fail! "I2: lock present → in flight"))
    (fs/delete-if-exists (fs/path git "index.lock"))
    (master-checkout-drift-lib/commit-in-flight?
     tmp [{:cmdline "git commit -m x" :cwd tmp}])
    (let [after (set (map str (fs/list-dir git)))]
      (when-not (= before after)
        (fail! "I2: in-flight detection must not leave extra files under .git")))))

(if (empty? @failures)
  (println "bl1137_cwd_scoped_mute_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1137_cwd_scoped_mute_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
