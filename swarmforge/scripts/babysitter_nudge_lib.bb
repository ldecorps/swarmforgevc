;; babysitter_nudge_lib.bb — verified resident-pane nudge for the hawk (BL-093 seam).
;;
;; Babysitter must never raw `tmux send-keys` into swarm panes; this lib routes
;; through agent_runtime_inject/notify-agent! with :text, same as handoffd.

(ns babysitter-nudge-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "handoff_lib.bb")))
(load-file (str (fs/path scripts-dir "chase_sweep_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_inject.bb")))

(defn tmux-socket-path [project-root]
  (fs/path project-root ".swarmforge" "tmux-socket"))

(defn read-tmux-socket [project-root]
  (let [file (tmux-socket-path project-root)]
    (when (fs/exists? file)
      (str/trim (slurp (str file))))))

(defn tmux! [& args]
  (apply process/sh "tmux" args))

(defn capture-pane-text [socket session]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session)))

(defn resolve-nudge-target
  "Returns {:socket :session :agent :role} or nil when the swarm is not running."
  [project-root role-name]
  (when-let [socket (not-empty (read-tmux-socket project-root))]
    (when-let [role-info (handoff-lib/load-role-info role-name project-root)]
      (let [session (handoff-lib/wake-session socket (:session role-info))]
        (assoc role-info :socket socket :wake-session session)))))

(defn pane-busy?
  "True when the target pane is mid-turn (BL-135 parity). Injecting then often
   loses Enter — skip and let the caller retry or Telegram."
  [pane-text]
  (chase-sweep-lib/actively-processing? pane-text))

(defn nudge-resident!
  "Verified inject of instruction text into a swarm role pane.
   Returns {:status :nudged|:skip-busy|:no-target|:failed :detail ...}."
  [project-root role-name text & {:keys [log-fn]}]
  (let [text (str/trim (str text))
        log! (or log-fn (fn [& _] nil))]
    (cond
      (str/blank? text)
      {:status :failed :detail "empty message"}

      :else
      (if-let [target (resolve-nudge-target project-root role-name)]
        (let [{:keys [socket wake-session agent role]} target
              pane (try (capture-pane-text socket wake-session) (catch Exception _ ""))]
          (if (pane-busy? pane)
            {:status :skip-busy
             :role role
             :session wake-session
             :detail "pane mid-turn (esc to interrupt) — retry when idle"}
            (try
              (let [result (agent-runtime-inject/notify-agent!
                            socket wake-session (or agent "claude")
                            :text text
                            :log-fn (fn [tag sess detail]
                                      (log! tag sess detail))
                            :script-rel-path agent-runtime-lib/ready-script-rel-path)]
                (if (= :failed result)
                  {:status :failed :role role :session wake-session
                   :detail "verified submit exhausted retries"}
                  {:status :nudged :role role :session wake-session}))
              (catch Exception e
                {:status :failed :role role :session wake-session
                 :detail (.getMessage e)}))))
        {:status :no-target
         :detail (str "no tmux socket or role \"" role-name "\" in roles.tsv")}))))

(defn format-cli-line [{:keys [status role session detail]}]
  (case status
    :nudged (str "NUDGED: " role " via " session)
    :skip-busy (str "SKIP_BUSY: " role " — " detail)
    :no-target (str "NO_NUDGE: " detail)
    :failed (str "FAILED: " (or detail "unknown"))
    (str "FAILED: " (or detail "unknown"))))
