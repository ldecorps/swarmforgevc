#!/usr/bin/env bb
;; swarm_status.bb — human status: agents, daemons, telegram bridge, recent handoffs.
;;
;; Usage:
;;   bb swarm_status.bb <project-root>
;;   bb swarm_status.bb <project-root> --handoffs 15
;;
;; Wired as: ./swarm status [project-root]

(ns swarm-status
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "swarm_status_lib.bb")))
(load-file (str (fs/path script-dir "mono_router_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: swarm_status.bb <project-root> [--handoffs N]"))
  (System/exit 1))

(def args *command-line-args*)

(def project-root
  (or (first (filter #(not (str/starts-with? % "-")) args))
      (usage)))

(def handoff-limit
  (or (some (fn [[a b]]
              (when (= a "--handoffs")
                (parse-long b)))
            (partition 2 1 args))
      12))

(def state-dir (fs/path project-root ".swarmforge"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
(def tmux-dir (fs/path state-dir "tmux"))

(defn now-ms [] (System/currentTimeMillis))

(defn now-iso []
  (str (java.time.Instant/now)))

(defn read-pid [path]
  (when (fs/exists? path)
    (try
      (let [s (str/trim (slurp (str path)))]
        (when-not (str/blank? s)
          (parse-long s)))
      (catch Exception _ nil))))

(defn pid-alive? [pid]
  (boolean
   (when pid
     (try
       (zero? (:exit (process/sh "kill" "-0" (str pid))))
       (catch Exception _ false)))))

(defn pid-etime [pid]
  (when (pid-alive? pid)
    (let [r (process/sh "ps" "-o" "etime=" "-p" (str pid))
          et (str/trim (:out r))]
      (when-not (str/blank? et) et))))

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

(defn tmux-sessions [sock]
  (when (and sock (fs/exists? sock))
    (let [r (process/sh "tmux" "-S" sock "list-sessions"
                        "-F" "#{session_name}\t#{session_created}")]
      (when (zero? (:exit r))
        (->> (str/split-lines (:out r))
             (remove str/blank?)
             (map (fn [line]
                    (let [[name created] (str/split line #"\t" 2)]
                      {:name name
                       :created-epoch-sec (some-> created parse-long)})))
             vec)))))

(defn parse-roles []
  (when (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (map (fn [line]
                (let [cols (str/split line #"\t")]
                  {:role (nth cols 0 nil)
                   :branch (nth cols 1 nil)
                   :worktree (nth cols 2 nil)
                   :session (nth cols 3 nil)
                   :title (nth cols 4 nil)
                   :agent (nth cols 5 nil)
                   :mode (nth cols 6 nil)
                   :rotate (nth cols 7 nil)})))
         vec)))

(defn rotation-router-mode? []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      (str (fs/path project-root "swarmforge" "swarmforge.conf")))
        conf-text (when (and conf-path (fs/exists? conf-path)) (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

(defn gather-agents [now]
  (let [sock (resolve-swarm-socket)
        sessions (tmux-sessions sock)
        by-name (into {} (map (juxt :name identity) sessions))
        roles (or (parse-roles) [])
        ordered (mapv :role roles)
        router? (rotation-router-mode?)
        ;; If roles.tsv missing, fall back to live sessions only.
        rows (if (seq roles)
               (map (fn [r]
                      (let [sess (:session r)
                            live (get by-name sess)
                            alive? (boolean live)
                            class (when router?
                                    (mono-router-lib/classify-role ordered (:role r)))
                            illicit? (and (= :dormant class) alive?)
                            dormant? (and (= :dormant class) (not alive?))]
                        (swarm-status-lib/agent-status-row
                         {:role (:role r)
                          :session sess
                          :agent (cond
                                   illicit? (str (:agent r) " ILLICIT-standing")
                                   (= :resident class) (str (:agent r) " resident")
                                   :else (:agent r))
                          :alive? (and alive? (not illicit?))
                          :dormant? dormant?
                          :created-epoch-sec (:created-epoch-sec live)
                          :now-ms now})))
                    roles)
               (map (fn [s]
                      (swarm-status-lib/agent-status-row
                       {:role (:name s)
                        :session (:name s)
                        :alive? true
                        :created-epoch-sec (:created-epoch-sec s)
                        :now-ms now}))
                    sessions))]
    ;; Also surface babysitter LLM if present (outside roles.tsv).
    (let [bb-sock (fs/path state-dir "babysitter" "babysitter-tmux.sock")
          bb-sessions (when (fs/exists? bb-sock)
                        (tmux-sessions (str bb-sock)))
          bb (some #(when (= "babysitter" (:name %)) %) bb-sessions)
          bb-row (when bb
                   (swarm-status-lib/agent-status-row
                    {:role "babysitter"
                     :session "babysitter"
                     :agent "aider"
                     :alive? true
                     :created-epoch-sec (:created-epoch-sec bb)
                     :now-ms now}))
          bb-down (when (and (fs/exists? (fs/path state-dir "babysitter" "enabled"))
                             (not bb))
                    (swarm-status-lib/agent-status-row
                     {:role "babysitter"
                      :session "babysitter"
                      :agent "aider"
                      :alive? false
                      :now-ms now}))]
      (vec (concat rows (remove nil? [bb-row bb-down]))))))

(defn daemon-from-pid
  [name path & {:keys [detail]}]
  (let [pid (read-pid path)
        alive (pid-alive? pid)
        et (pid-etime pid)]
    (swarm-status-lib/daemon-status-row
     {:name name
      :alive? (if pid alive false)
      :uptime et
      :detail (str/join " "
                        (remove str/blank?
                                [(when pid (str "pid=" pid))
                                 detail
                                 (when (and pid (not alive)) "stale-pid")]))})))

(defn gather-daemons []
  (let [op (fs/path state-dir "operator")
        daemon (fs/path state-dir "daemon")
        bb (fs/path state-dir "babysitter")]
    [(daemon-from-pid "handoffd" (fs/path daemon "handoffd.pid"))
     (daemon-from-pid "handoffd-supervisor" (fs/path daemon "handoffd-supervisor.pid"))
     (daemon-from-pid "operator-runtime" (fs/path op "runtime.pid"))
     (daemon-from-pid "babysitter-runtime" (fs/path bb "runtime.pid"))
     (daemon-from-pid "cloudflare-tunnel" (fs/path op "tunnel.pid"))]))

(defn read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true)
         (catch Exception _ nil))))

(defn gather-telegram [now]
  (let [status-path (fs/path state-dir "operator" "front-desk-supervisor.status.json")
        st (read-json status-path)
        bridge (:bridge st)
        bot (:bot st)
        supervisor-pid-file (fs/path state-dir "operator" "front-desk-supervisor.pid")
        sup (daemon-from-pid "front-desk-supervisor" supervisor-pid-file)]
    (cond-> [sup]
      bridge
      (conj (swarm-status-lib/daemon-status-row
             {:name "telegram-bridge"
              :alive? (= "running" (str (:status bridge)))
              :uptime (swarm-status-lib/uptime-from-started-ms now (:started-at-ms bridge))
              :detail (str "pid=" (:pid bridge) " status=" (:status bridge))}))
      bot
      (conj (swarm-status-lib/daemon-status-row
             {:name "front-desk-bot"
              :alive? (= "running" (str (:status bot)))
              :uptime (swarm-status-lib/uptime-from-started-ms now (:started-at-ms bot))
              :detail (str "pid=" (:pid bot) " status=" (:status bot))})))))

(defn list-sent-handoffs []
  (let [root (fs/path state-dir "handoffs")]
    (if-not (fs/directory? root)
      []
      (->> (fs/glob root "**/sent/*.handoff")
           (map (fn [p]
                  {:path (str p)
                   :mtime-ms (fs/file-time->millis (fs/last-modified-time p))}))
           (sort-by :mtime-ms >)
           (take handoff-limit)
           vec))))

(defn gather-handoffs [now]
  (mapv (fn [{:keys [path mtime-ms]}]
          (let [content (try (slurp path) (catch Exception _ ""))
                mtime-iso (when mtime-ms
                            (str (java.time.Instant/ofEpochMilli mtime-ms)))]
            (swarm-status-lib/summarize-handoff content
                                                {:path path
                                                 :mtime-iso mtime-iso
                                                 :mtime-ms mtime-ms
                                                 :now-ms now})))
        (list-sent-handoffs)))

(defn -main []
  (let [now (now-ms)
        report (swarm-status-lib/render-status-report
                {:project-root project-root
                 :generated-at (now-iso)
                 :agents (gather-agents now)
                 :daemons (gather-daemons)
                 :telegram (gather-telegram now)
                 :handoffs (gather-handoffs now)})]
    (print report)
    (flush)))

(-main)
