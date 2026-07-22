#!/usr/bin/env bb
;; babysitter_assess.bb — capture mono-router standing panes and assess health.
;;
;; Usage:
;;   bb babysitter_assess.bb <project-root>
;;   bb babysitter_assess.bb <project-root> --notify
;;
;; Outputs JSON on stdout. With --notify, posts a Babysitter Telegram summary
;; when issues are found (requires TELEGRAM_* env + notify-babysitter.js).

(ns babysitter-assess
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "babysitter_assess_lib.bb")))
(load-file (str (fs/path script-dir "loop_detect_lib.bb")))
(load-file (str (fs/path script-dir "mono_router_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: babysitter_assess.bb <project-root> [--notify]"))
  (System/exit 1))

(def args *command-line-args*)
(def project-root
  (or (first (remove #(str/starts-with? % "-") args)) (usage)))
(def notify? (boolean (some #{"--notify"} args)))

(def state-dir (fs/path project-root ".swarmforge"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
(def tmux-dir (fs/path state-dir "tmux"))

(defn now-ms [] (System/currentTimeMillis))

(defn resolve-swarm-socket []
  (cond
    (and (fs/exists? socket-file)
         (let [p (str/trim (slurp (str socket-file)))]
           (fs/exists? p)))
    (str/trim (slurp (str socket-file)))

    (fs/directory? tmux-dir)
    (->> (fs/list-dir tmux-dir)
         (filter #(str/ends-with? (str %) ".sock"))
         (sort-by str)
         last
         str)

    :else nil))

(defn tmux! [& cmd-args]
  (process/sh (concat ["tmux"] cmd-args)))

(defn tmux-sessions [sock]
  (when (and sock (fs/exists? sock))
    (let [r (tmux! "-S" sock "list-sessions" "-F" "#{session_name}")]
      (when (zero? (:exit r))
        (->> (str/split-lines (:out r))
             (remove str/blank?)
             set)))))

(defn parse-roles []
  (when (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (map (fn [line]
                (let [cols (str/split line #"\t")]
                  {:role (nth cols 0 nil)
                   :session (nth cols 3 nil)})))
         vec)))

(defn capture-pane-tail [sock session n]
  (when (and sock session)
    (let [r (tmux! "-S" sock "capture-pane" "-p" "-t" session "-S" (str "-" n))]
      (when (zero? (:exit r)) (:out r)))))

(defn count-in-process [role]
  (let [dir (fs/path state-dir "handoffs" role "inbox" "in_process")]
    (if (fs/exists? dir)
      (count (fs/list-dir dir))
      0)))

(defn last-activity-ms [role]
  (let [paths [(fs/path state-dir "handoffs" role "inbox" "new")
               (fs/path state-dir "handoffs" role "inbox" "in_process")
               (fs/path state-dir "handoffs" role "outbox" "sent")]]
    (apply max 0
           (for [p paths :when (fs/exists? p)]
             (.toMillis (fs/last-modified-time p))))))

(defn assess-standing-agents []
  (let [sock (resolve-swarm-socket)
        sessions (or (tmux-sessions sock) #{})
        roles (or (parse-roles) [])
        ordered (mapv :role roles)
        standing (babysitter-assess-lib/mono-router-standing-roles ordered)
        now (now-ms)]
  (mapv
   (fn [role]
     (let [row (first (filter #(= role (:role %)) roles))
           sess (:session row)
           alive? (boolean (and sess (contains? sessions sess)))
           pane (or (capture-pane-tail sock sess 20) "")
           loop-signal (loop-detect-lib/classify-pane-loop-signal pane)
           in-proc (count-in-process role)
           idle-ms (when alive? (- now (last-activity-ms role)))]
       (babysitter-assess-lib/assess-agent
        {:role role
         :class (mono-router-lib/classify-role ordered role)
         :alive? alive?
         :pane-tail pane
         :in-process-count in-proc
         :loop-signal loop-signal
         :idle-ms idle-ms})))
   standing)))

(defn notify-issues! [summary]
  (when (and notify? (= :issues (:status summary)))
    (let [notify-js (fs/path project-root "extension" "out" "tools" "notify-babysitter.js")
          text (babysitter-assess-lib/format-telegram-glitch summary)]
      (when (fs/exists? notify-js)
        (process/sh "node" (str notify-js) "--project-root" project-root
                    "--text" text)))))

(defn -main []
  (let [agents (assess-standing-agents)
        summary (assoc (babysitter-assess-lib/summarize-assess agents)
                       :report (babysitter-assess-lib/format-assess-report
                                (babysitter-assess-lib/summarize-assess agents))
                       :at (str (java.time.Instant/now)))]
    (notify-issues! summary)
    (println (json/generate-string summary))))

(-main)
