#!/usr/bin/env bb
;; gpu_pause_cli.bb <project-root> arm <30m|1h|2h>
;; gpu_pause_cli.bb <project-root> clear
;;
;; arm writes the marker FIRST, then stops every local-model seat's qwen
;; and unloads its model. The marker is what stops babysitter from reading
;; the stopped seat as a half-launch and relaunching it. clear drops the
;; marker; the next babysitter sweep repairs the seat and the GPU comes back.

(ns gpu-pause-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "gpu_pause_lib.bb")))
(load-file (str (fs/path script-dir "local_llm_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: gpu_pause_cli.bb <project-root> arm <30m|1h|2h>")
    (println "       gpu_pause_cli.bb <project-root> clear"))
  (System/exit 1))

(def args (vec *command-line-args*))
(def project-root (first args))
(def command (second args))
(def duration-token (nth args 2 nil))

(when (or (str/blank? (str project-root))
          (not (#{"arm" "clear"} command)))
  (usage!))

(def state-dir (fs/path project-root ".swarmforge"))
(def marker-path (fs/path state-dir "operator" "gpu-pause.json"))

(defn- write-marker! [state]
  (fs/create-dirs (fs/parent marker-path))
  (spit (str marker-path) (json/generate-string state)))

(defn- roles []
  (let [f (fs/path state-dir "roles.tsv")]
    (if-not (fs/exists? f)
      []
      (->> (str/split-lines (slurp (str f)))
           (remove str/blank?)
           (map (fn [line]
                  (let [cols (str/split line #"\t" -1)]
                    {:role (get cols 0)
                     :session (get cols 3)
                     :agent (let [a (get cols 5)] (if (str/blank? a) "claude" a))})))
           (filter #(gpu-pause-lib/local-model-seat? (:agent %)))
           vec))))

(defn- socket []
  (let [f (fs/path state-dir "tmux-socket")]
    (when (fs/exists? f)
      (let [s (str/trim (slurp (str f)))]
        (when (fs/exists? s) s)))))

(defn- sh! [& argv]
  (try
    (apply process/sh argv)
    (catch Exception e {:exit 1 :out "" :err (.getMessage e)})))

(defn- pane-pid [sock session]
  (let [{:keys [exit out]} (sh! "tmux" "-S" sock "list-panes" "-t" session "-F" "#{pane_pid}")]
    (when (zero? exit)
      (some-> (first (remove str/blank? (str/split-lines out))) str/trim not-empty))))

(defn- descendant-pids [root-pid]
  (let [{:keys [exit out]} (sh! "ps" "-eo" "pid=,ppid=")]
    (if-not (zero? exit)
      []
      (let [edges (->> (str/split-lines out)
                       (keep (fn [line]
                               (let [[pid ppid] (str/split (str/trim line) #"\s+")]
                                 (when (and pid ppid) [ppid pid]))))
                       (group-by first))]
        (loop [frontier [root-pid] found []]
          (if (empty? frontier)
            found
            (let [kids (mapcat #(map second (get edges % [])) frontier)]
              (recur kids (into found kids)))))))))

(defn- cmdline [pid]
  (let [{:keys [exit out]} (sh! "ps" "-p" (str pid) "-o" "args=")]
    (when (zero? exit) out)))

(defn- stop-seat-agents! [sock seat]
  (when-let [root (pane-pid sock (:session seat))]
    (doseq [pid (descendant-pids root)]
      (when (re-find #"qwen" (or (cmdline pid) ""))
        (sh! "kill" (str pid))))))

(defn- unload-model! [seat]
  (let [script (slurp (str (fs/path state-dir "launch" (str (:role seat) ".sh"))))
        {:keys [model endpoint]} (local-llm-lib/parse-launch-script script)
        base (or endpoint "http://127.0.0.1:11434")]
    (when-not (str/blank? (str model))
      (sh! "curl" "-sS" "-m" "8" "-X" "POST" (str base "/api/generate")
           "-H" "content-type: application/json"
           "-d" (json/generate-string {:model model :keep_alive 0}))
      (sh! "ollama" "stop" model))))

(defn- quiet! []
  (let [sock (socket)
        seats (roles)]
    (doseq [seat seats]
      (when sock (stop-seat-agents! sock seat))
      (try (unload-model! seat) (catch Exception _ nil)))
    ;; A generate still in flight keeps llama-server resident after qwen
    ;; dies. Stopping that process is what makes the fans drop. ollama
    ;; serve stays up; the next seat launch loads the model again.
    (let [{:keys [out]} (sh! "ps" "-eo" "pid=,args=")]
      (doseq [line (str/split-lines (or out ""))]
        (when (str/includes? line "llama-server")
          (when-let [pid (second (re-find #"^\s*(\d+)" line))]
            (sh! "kill" pid)))))
    seats))

(case command
  "arm"
  (if-let [ms (gpu-pause-lib/duration-ms-for duration-token)]
    (do
      (write-marker! {:active true
                      :untilMs (+ (System/currentTimeMillis) ms)
                      :duration duration-token})
      (let [seats (quiet!)]
        (println (str "gpu-pause armed " duration-token
                      " seats=" (str/join "," (map :role seats))))))
    (usage!))

  "clear"
  (do
    (write-marker! {:active false})
    (println "gpu-pause cleared")))
