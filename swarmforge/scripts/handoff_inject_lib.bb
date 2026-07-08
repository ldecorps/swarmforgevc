;; BL-154: verified tmux wake + parcel delivery for phase-1 (no daemon).
;; Shared by swarm_handoff.bb (sync deliver) and available to handoffd.bb later.
(ns handoff-inject-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_inject.bb")))

(def wake-message agent-runtime-lib/default-wake-chat-message)

(def notify-max-retries 3)
(def notify-retry-delay-ms 200)

(defn now []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT)
           (java.time.Instant/now)))

(defn inject-traffic-log [project-root]
  (fs/path project-root ".swarmforge" "handoffs" "inject-traffic.log"))

(defn record-inject-traffic!
  "Append one machine-parseable line: timestamp key=value fields."
  [project-root fields]
  (let [file (inject-traffic-log project-root)
        stamp (now)
        body (str/join " "
                       (concat
                        (for [[k v] (dissoc fields :detail)
                              :when (some? v)]
                          (str (name k) "=" (if (string? v) v (str v))))
                        (when-let [d (:detail fields)]
                          [(str "detail=" d)])))]
    (fs/create-dirs (fs/parent file))
    (spit (str file) (str stamp " " body "\n") :append true)))

(defn tmux! [& args]
  (apply process/sh "tmux" args))

(defn capture-pane-text [socket session]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session)))

(defn last-non-blank-line [pane-text]
  (last (remove str/blank? (str/split-lines (or pane-text "")))))

(defn pending-input-line [pane-text]
  (let [line (last-non-blank-line pane-text)]
    (if (nil? line)
      ""
      (if-let [[_ tail] (re-find #"[$#❯>]\s*(\S.*)?$" line)]
        (str/trim (or tail ""))
        ""))))

(defn pending-input? [pane-text]
  (not (str/blank? (pending-input-line pane-text))))

(defn text-still-pending? [pane-text text]
  (let [pending (pending-input-line pane-text)]
    (and (not (str/blank? pending)) (str/includes? pending (str/trim text)))))

(defn send-submit! [socket session]
  (let [cr (tmux! "-S" socket "send-keys" "-t" session "C-m")]
    (Thread/sleep 50)
    (let [lf (tmux! "-S" socket "send-keys" "-t" session "C-j")]
      (and (zero? (:exit cr)) (zero? (:exit lf))))))

(defn notify!
  "Delivers agent-specific wake to session's pane with verified submit."
  [socket session & {:keys [log-fn traffic agent]}]
  (let [log! (or log-fn (fn [& _] nil))
        on-outcome (fn [outcome detail attempts stacked?]
                     (when traffic
                       (record-inject-traffic! (:project-root traffic)
                                               (cond-> {:source (or (:source traffic) "inject")
                                                        :outcome outcome
                                                        :role (:role traffic)
                                                        :session session
                                                        :parcel (:parcel traffic)}
                                                 detail (assoc :detail detail)
                                                 attempts (assoc :attempts attempts)
                                                 stacked? (assoc :stacked stacked?)))))]
    (agent-runtime-inject/notify-agent! socket session (or agent "claude")
                                        :log-fn log-fn
                                        :on-outcome on-outcome
                                        :script-rel-path agent-runtime-lib/ready-script-rel-path)))

(defn read-lines [path]
  (when (fs/exists? path)
    (str/split-lines (slurp (str path)))))

(defn load-roles [roles-file]
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

(defn delivered-filename [filename recipient]
  (str/replace filename #"\.handoff$" (str "_for_" recipient ".handoff")))

(defn target-path [role-info filename recipient]
  (fs/path (:worktree-path role-info)
           ".swarmforge" "handoffs" "inbox" "new"
           (delivered-filename filename recipient)))

(defn sent-dir [role-info]
  (fs/path (:worktree-path role-info) ".swarmforge" "handoffs" "sent"))

(defn move-with-collision [source target-dir]
  (fs/create-dirs target-dir)
  (let [base (fs/file-name source)
        target (fs/path target-dir base)]
    (if (fs/exists? target)
      (let [uniq (fs/path target-dir (str (now) "_" base))]
        (fs/move source uniq {:replace-existing false})
        uniq)
      (do
        (fs/move source target {:replace-existing false})
        target))))

(defn deliver-parcel!
  "Moves outbox parcel to each recipient inbox/new and wakes the pane."
  [project-root outbox-path sender-role & {:keys [log-fn]}]
  (let [state-dir (fs/path project-root ".swarmforge")
        roles-file (fs/path state-dir "roles.tsv")
        socket-file (fs/path state-dir "tmux-socket")
        roles (load-roles roles-file)
        socket (when (fs/exists? socket-file)
                 (str/trim (slurp (str socket-file))))
        filename (fs/file-name outbox-path)
        message (parse-message outbox-path)
        headers (:headers message)
        recipients (some-> (get headers "to") (str/split #",") seq)]
    (when-not socket
      (throw (ex-info "tmux socket file missing" {:path (str socket-file)})))
    (when-not recipients
      (throw (ex-info "missing to header" {:path (str outbox-path)})))
    (doseq [recipient recipients]
      (let [role-info (get roles recipient)]
        (when-not role-info
          (throw (ex-info (str "unknown recipient " recipient) {:recipient recipient})))
        (let [target (target-path role-info filename recipient)
              delivered (add-delivery-headers message recipient)]
          (fs/create-dirs (fs/parent target))
          (when-not (fs/exists? target)
            (spit (str target) (render-message (:headers delivered) (:body delivered))))
          (notify! socket (:session role-info)
                   :log-fn log-fn
                   :agent (:agent role-info)
                   :traffic {:project-root project-root
                             :source "sync-deliver"
                             :role recipient
                             :parcel filename}))))
    (move-with-collision outbox-path (sent-dir (get roles sender-role)))))
