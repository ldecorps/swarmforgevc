#!/usr/bin/env bb

;; Subprocess calls use babashka.process, NOT clojure.java.shell: bb's
;; clojure.java.shell shim can deadlock reading subprocess streams (observed
;; hanging notify! mid-delivery and silently stalling the whole swarm, BL-061).
(ns handoffd
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(def poll-ms 1000)
(def wake-message
  "You have new handoff mail. If idle, run ready_for_next.sh.")

(defn usage []
  (binding [*out* *err*]
    (println "Usage: handoffd.bb <project-root>"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

(def state-dir (fs/path project-root ".swarmforge"))
(def daemon-dir (fs/path state-dir "daemon"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
(def pid-file (fs/path daemon-dir "handoffd.pid"))
(def stop-file (fs/path daemon-dir "stop"))
(def log-file (fs/path daemon-dir "handoffd.log"))
(def heartbeat-file (fs/path daemon-dir "handoffd.heartbeat"))
(def heartbeat-log-every-cycles 60)
(def stopping? (atom false))

(defn now []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))

(defn log! [& parts]
  (fs/create-dirs daemon-dir)
  (spit (str log-file)
        (str (now) " " (str/join " " parts) "\n")
        :append true))

(defn read-lines [path]
  (when (fs/exists? path)
    (str/split-lines (slurp (str path)))))

(defn load-roles []
  (into {}
        (for [line (read-lines roles-file)
              :when (not (str/blank? line))
              :let [[role worktree-name worktree-path session display agent receive-mode]
                    (str/split line #"\t")]]
          [role {:role role
                 :worktree-name worktree-name
                 :worktree-path worktree-path
                 :session session
                 :display display
                 :agent agent
                 :receive-mode (or receive-mode "task")}])))

(defn parse-message [path]
  (let [content (slurp (str path))
        [header body] (str/split content #"\n\n" 2)
        headers (into {}
                      (for [line (str/split-lines header)
                            :let [[k v] (str/split line #": " 2)]
                            :when (and k v)]
                        [k v]))]
    {:headers headers
     :body (or body "")
     :content content}))

(defn render-message [headers body]
  (let [preferred ["id" "from" "to" "recipient" "priority" "type" "role" "commit"
                   "message" "created_at" "enqueued_at" "dequeued_at" "completed_at"]
        remaining (->> (keys headers)
                       (remove (set preferred))
                       sort)
        ordered (concat preferred remaining)]
    (str (str/join "\n"
                   (for [k ordered
                         :let [v (get headers k)]
                         :when v]
                     (str k ": " v)))
         "\n\n"
         body)))

(defn add-delivery-headers [message recipient]
  (-> message
      (assoc-in [:headers "recipient"] recipient)
      (assoc-in [:headers "enqueued_at"] (now))))

(defn rule-proposals-file []
  (fs/path state-dir "rule_proposals"
           (str (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                         (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC))
                ".jsonl")))

(defn json-escape [s]
  (-> (or s "")
      (str/replace "\\" "\\\\")
      (str/replace "\"" "\\\"")
      (str/replace "\n" "\\n")))

;; Durable audit trail for BL-035 rule_proposal handoffs: one line per
;; delivered proposal, appended at delivery time (not the eventual
;; accept/reject outcome — the specifier's review is prompt/agent behavior,
;; not scriptable code here).
(defn append-rule-proposal! [headers]
  (let [file (rule-proposals-file)
        line (str "{\"scope\":\"" (json-escape (get headers "scope")) "\","
                  "\"body\":\"" (json-escape (get headers "body")) "\","
                  "\"rationale\":\"" (json-escape (get headers "rationale")) "\","
                  "\"proposer\":\"" (json-escape (get headers "from")) "\","
                  "\"timestamp\":\"" (now) "\"}")]
    (fs/create-dirs (fs/parent file))
    (spit (str file) (str line "\n") :append true)))

(defn delivered-filename
  "Per-recipient copy name. Recipients that share an inbox directory (e.g.
   coordinator and specifier on master) would otherwise collide on the original
   outbox filename and clobber each other's copy (BL-057). The recipient is
   appended just before the extension so the leading
   <priority>_<timestamp>_<sequence> sort order is untouched."
  [filename recipient]
  (str/replace filename #"\.handoff$" (str "_for_" recipient ".handoff")))

(defn target-path [role-info filename recipient]
  (fs/path (:worktree-path role-info)
           ".swarmforge" "handoffs" "inbox" "new"
           (delivered-filename filename recipient)))

(defn tmux! [& args]
  (apply process/sh "tmux" args))

(defn notify! [socket session]
  (let [send-text (tmux! "-S" socket "send-keys" "-t" session "-l" wake-message)
        _ (Thread/sleep 150)
        send-carriage-return (tmux! "-S" socket "send-keys" "-t" session "C-m")
        _ (Thread/sleep 50)
        send-line-feed (tmux! "-S" socket "send-keys" "-t" session "C-j")]
    (when-not (zero? (:exit send-text))
      (throw (ex-info "tmux send text failed" send-text)))
    (when-not (zero? (:exit send-carriage-return))
      (throw (ex-info "tmux send carriage return failed" send-carriage-return)))
    (when-not (zero? (:exit send-line-feed))
      (throw (ex-info "tmux send line feed failed" send-line-feed)))))

(defn move-with-collision [source target-dir]
  (fs/create-dirs target-dir)
  (let [base (fs/file-name source)
        target (fs/path target-dir base)]
    (if (fs/exists? target)
      (fs/move source
               (fs/path target-dir (str (now) "_" base))
               {:replace-existing false})
      (fs/move source target {:replace-existing false}))))

(defn fail! [path reason]
  (let [failed-dir (fs/path (fs/parent (fs/parent path)) "failed")]
    (log! "failed" (str path) reason)
    (spit (str path ".error") (str reason "\n"))
    (move-with-collision path failed-dir)))

(defn deliver! [roles socket sender-role path]
  (let [filename (fs/file-name path)
        message (parse-message path)
        headers (:headers message)
        recipients (some-> (get headers "to") (str/split #",") seq)]
    (if-not recipients
      (fail! path "missing to header")
      (do
        (doseq [recipient recipients]
          (let [role-info (get roles recipient)]
            (when-not role-info
              (throw (ex-info (str "unknown recipient " recipient) {:recipient recipient})))
            (let [target (target-path role-info filename recipient)
                  delivered (add-delivery-headers message recipient)]
              (fs/create-dirs (fs/parent target))
              (when-not (fs/exists? target)
                (spit (str target) (render-message (:headers delivered) (:body delivered))))
              (notify! socket (:session role-info)))))
        (when (= "rule_proposal" (get headers "type"))
          (append-rule-proposal! headers))
        (move-with-collision path
                             (fs/path (get-in roles [sender-role :worktree-path])
                                      ".swarmforge" "handoffs" "sent"))
        (log! "delivered" (str path))))))

(defn inbox-new-files [role-info]
  (let [new-dir (fs/path (:worktree-path role-info) ".swarmforge" "handoffs" "inbox" "new")]
    (when (fs/exists? new-dir)
      (->> (fs/list-dir new-dir)
           (filter #(and (fs/regular-file? %)
                         (str/ends-with? (fs/file-name %) ".handoff")))
           seq))))

(defn outbox-files [role-info]
  (let [outbox (fs/path (:worktree-path role-info) ".swarmforge" "handoffs" "outbox")]
    (when (fs/exists? outbox)
      (->> (fs/list-dir outbox)
           (filter #(and (fs/regular-file? %)
                         (str/ends-with? (fs/file-name %) ".handoff")))
           (sort-by #(fs/file-name %))))))

(defn startup-notify-pending! [roles socket]
  (doseq [[_ role-info] roles
          :when (seq (inbox-new-files role-info))]
    (log! "startup-notify" (:role role-info))
    (try
      (notify! socket (:session role-info))
      (catch Exception e
        (log! "startup-notify-error" (:role role-info) (.getMessage e))))))

(defn poll-once! []
  (let [roles (load-roles)
        socket (str/trim (slurp (str socket-file)))]
    (doseq [[role role-info] roles
            path (or (outbox-files role-info) [])]
      (try
        (deliver! roles socket role path)
        (catch Exception e
          (log! "error" (str path) (.getMessage e))
          (try
            (fail! path (.getMessage e))
            (catch Exception nested
              (log! "failed-to-archive" (str path) (.getMessage nested)))))))))

(defn shutdown! []
  (reset! stopping? true))

(def startup-notify-only?
  (some #{"--startup-notify-only"} *command-line-args*))

(defn -main []
  (let [roles  (load-roles)
        socket (str/trim (slurp (str socket-file)))]
    (if startup-notify-only?
      (do
        (startup-notify-pending! roles socket)
        (log! "startup-notify-only done"))
      (do
        (fs/create-dirs daemon-dir)
        (fs/delete-if-exists stop-file)
        (spit (str pid-file) (str (.pid (java.lang.ProcessHandle/current)) "\n"))
        (.addShutdownHook (Runtime/getRuntime) (Thread. shutdown!))
        (log! "started")
        (try
          (startup-notify-pending! roles socket)
          ;; The heartbeat file (every cycle) and log line (periodic) let the
          ;; supervisor detect a hung daemon and a post-mortem see liveness up
          ;; to the moment of death (BL-061).
          (loop [cycle 0]
            (when (and (not @stopping?) (not (fs/exists? stop-file)))
              (poll-once!)
              (spit (str heartbeat-file) (str (now) "\n"))
              (when (zero? (mod cycle heartbeat-log-every-cycles))
                (log! "heartbeat" (str "cycle=" cycle)))
              (Thread/sleep poll-ms)
              (recur (inc cycle))))
          (finally
            (fs/delete-if-exists pid-file)
            (log! "stopped")))))))

(-main)
