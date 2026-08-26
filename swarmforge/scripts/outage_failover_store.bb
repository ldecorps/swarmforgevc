#!/usr/bin/env bb
;; BL-669: fs/process adapter for outage records, active swap state, Operator
;; announcements, and COST-root experiment-log annotations.
(ns outage-failover-store
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-state-dir-rel ".swarmforge/outage-failover")
(def outages-file-rel ".swarmforge/telemetry/provider-outages.jsonl")
(def experiment-log-rel ".swarmforge/telemetry/outage-failover-experiment.jsonl")
(def active-swap-file-name "active-swap.json")

(def ^:private this-file (fs/canonicalize *file*))

(defn repo-root [] (fs/parent (fs/parent (fs/parent this-file))))

(defn state-dir
  ([project-root] (str (fs/path project-root default-state-dir-rel)))
  ([]
   (or (System/getenv "OUTAGE_FAILOVER_STATE_DIR")
       (state-dir (repo-root)))))

(defn outages-path [project-root]
  (or (System/getenv "OUTAGE_FAILOVER_RECORDS_FILE")
      (str (fs/path project-root outages-file-rel))))

(defn experiment-log-path [project-root]
  (str (fs/path project-root experiment-log-rel)))

(defn active-swap-path [dir]
  (fs/path dir active-swap-file-name))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn append-jsonl! [path entry]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (json/generate-string entry) "\n") :append true))

(defn read-jsonl [path]
  (when (fs/exists? path)
    (->> (str/split-lines (slurp (str path)))
         (remove str/blank?)
         (mapv #(json/parse-string % true)))))

(defn read-outage-records! [project-root]
  (or (read-jsonl (outages-path project-root)) []))

(defn write-outage-records! [project-root records]
  (let [path (outages-path project-root)]
    (fs/create-dirs (fs/parent path))
    (spit (str path)
          (str/join "\n" (map json/generate-string records))
          :append false)
    (when (seq records) (spit (str path) "\n"))))

(defn read-active-swap! [dir]
  (try
    (let [p (active-swap-path dir)]
      (when (fs/exists? p)
        (json/parse-string (slurp (str p)) true)))
    (catch Exception _ {})))

(defn write-active-swap! [dir active-swap]
  (atomic-spit! (active-swap-path dir) (json/generate-string (or active-swap {}))))

(defn append-experiment-log! [project-root entry]
  (append-jsonl! (experiment-log-path project-root) entry))

(defn announce-operator! [project-root text]
  (let [outbox (fs/path project-root ".swarmforge" "operator" "telegram-reply-outbox.jsonl")]
    (append-jsonl! outbox {"threadId" "OPERATOR" "text" text})))

(defn merge-seat-overlay!
  "Returns the merged overlay map; caller persists via model-factory-store."
  [current-overlay seat assignment-entry]
  (assoc (or current-overlay {}) (keyword seat) assignment-entry))

(defn respawn-seat!
  "Idle-boundary respawn for one seat — no-op when SWARMFORGE_SKIP_TMUX_INJECT=1."
  [project-root role socket]
  (when (and socket (not= "1" (System/getenv "SWARMFORGE_SKIP_TMUX_INJECT")))
    (let [launch (fs/path project-root ".swarmforge" "launch" (str role ".sh"))]
      (when (fs/exists? launch)
        @(process/process ["tmux" "-S" socket "respawn-pane" "-k" "-t" (str role ":0.0")
                           "bash" (str launch)]
                          {:dir (str project-root) :out :inherit :err :inherit})))))
