#!/usr/bin/env bb
;; BL-533 properties:
;;   I1 untracked acceptance on disk never passes hygiene
;;   I2 multi-slice epic needs required_wiring on a child

(require '[babashka.fs :as fs]
         '[babashka.process :as process])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "backlog_hygiene_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(defn- sh! [args dir]
  (let [r @(process/process args {:dir dir :out :string :err :string})]
    {:exit (:exit r) :out (str (:out r) (:err r))}))

(defn- git! [root & args]
  (sh! (into ["git" "-c" "user.email=t@t" "-c" "user.name=t"] args) root))

;; I1: feature on disk, not in ls-files → untracked-acceptance violation.
(let [tmp (str (fs/create-temp-dir {:prefix "bl533-i1-"}))
      _ (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))
      feat "specs/features/BL-533-prop.feature"
      ticket-text (str "id: BL-533\ntype: feature\nepic: e\nmilestone: M8\n"
                       "acceptance: " feat "\npriority: 1\n")]
  (git! tmp "init" "-q" "-b" "main")
  (git! tmp "commit" "-q" "--allow-empty" "-m" "init")
  (fs/create-dirs (fs/path tmp "specs" "features"))
  (spit (str (fs/path tmp feat)) "Feature: prop\n")
  ;; deliberately do NOT git-add the feature
  (let [v (backlog-hygiene-lib/untracked-acceptance-violation
           ticket-text {:id "BL-533" :path "t.yaml" :repo-root tmp})]
    (when-not (= :untracked-acceptance (:kind v))
      (fail! (str "I1: expected untracked-acceptance, got " (pr-str v)))))
  (let [vs (backlog-hygiene-lib/violations-for-text
            ticket-text {:id "BL-533" :path "t.yaml" :repo-root tmp})]
    (when-not (some #(= :untracked-acceptance (:kind %)) vs)
      (fail! "I1: violations-for-text must include untracked-acceptance"))
    (when (backlog-hygiene-lib/all-clean? vs)
      (fail! "I1: untracked acceptance must never pass all-clean?")))
  ;; After tracking, the violation must clear (non-vacuous opposite).
  (git! tmp "add" feat)
  (git! tmp "commit" "-q" "-m" "track-feat")
  (when (backlog-hygiene-lib/untracked-acceptance-violation
         ticket-text {:id "BL-533" :path "t.yaml" :repo-root tmp})
    (fail! "I1: tracked acceptance must not be untracked-acceptance")))

;; I2: multi-slice epic wiring
(when (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
             "type: epic\ndecomposes_into: [A, B]\n" ["id: A\n" "id: B\n"]))
  (fail! "I2: unwired multi-slice epic must fail checklist"))

(when-not (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
                 "type: epic\ndecomposes_into: [A, B]\n"
                 ["id: A\nrequired_wiring: [x::y]\n" "id: B\n"]))
  (fail! "I2: one wired child must pass"))

(when (backlog-hygiene-lib/required-wiring-nonempty? "id: X\n")
  (fail! "empty wiring must be false"))

(when-not (backlog-hygiene-lib/required-wiring-nonempty?
           "required_wiring:\n  - \"a::b\"\n")
  (fail! "block wiring must be nonempty"))

(if (empty? @failures)
  (println "bl533_exit_gates_property: ALL PROPERTIES HOLD")
  (do (println (str "bl533_exit_gates_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
