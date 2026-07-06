#!/usr/bin/env bb

;; BL-145: `./swarm ensure` brings a swarm to a known-good state in one
;; idempotent command instead of three separate manual mechanisms (BL-058's
;; extension bounce, per-role pane launch/respawn, and handoffd supervision).
;; It checks and repairs, in order: the extension host, every configured
;; agent pane, then the daemon. Each component reports HEALTHY, FIXED (naming
;; the repair), or FAILED - never silently. A failed repair does not abort
;; the remaining checks. Exit status is non-zero if anything could not be
;; brought to health.
;;
;; Usage: swarm_ensure.bb <project-root>
;;
;; Decision logic (classify) is a pure function driven by injected
;; healthy-before?/healthy-after? booleans, mirroring
;; handoffd_supervisor.bb's evaluate-health - see test_swarm_ensure.sh for
;; the fake-probe unit tests and the fixture-driven integration scenarios.

(ns swarm-ensure
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: swarm_ensure.bb <project-root>"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
(def extension-dir (fs/path script-dir ".." ".." "extension"))

;; Real commands, overridable so tests can substitute lightweight fakes for
;; the extension check/bounce (which otherwise shells out to VS Code) and
;; for the daemon supervisor tick.
(def extension-check-cmd
  (or (System/getenv "SWARM_ENSURE_EXTENSION_CHECK_CMD")
      (str "node " (fs/path extension-dir "scripts" "checkExtensionHealth.js"))))

(def extension-bounce-cmd
  (or (System/getenv "SWARM_ENSURE_EXTENSION_BOUNCE_CMD")
      (str (fs/path extension-dir "scripts" "start-extension-dev.sh"))))

(def supervisor-cmd
  (or (System/getenv "SWARM_ENSURE_SUPERVISOR_CMD")
      (str "bb " (fs/path script-dir "handoffd_supervisor.bb") " " project-root " --check-once")))

;; ── pure decision ────────────────────────────────────────────────────────────

(defn classify
  "Given whether a component was healthy before any repair was attempted and
   whether it is healthy after, decides the report status. A component never
   attempts repair when already healthy, so healthy-after? is only consulted
   when healthy-before? is false."
  [healthy-before? healthy-after?]
  (cond
    healthy-before? :healthy
    healthy-after? :fixed
    :else :failed))

;; ── shell helpers ────────────────────────────────────────────────────────────

(defn sh! [cmd-str]
  (let [{:keys [exit] :as result} (process/sh {:continue true} "sh" "-c" cmd-str)]
    (assoc result :ok? (zero? exit))))

(defn tmux-socket []
  (when (fs/exists? socket-file)
    (str/trim (slurp (str socket-file)))))

(defn role-rows
  "Each configured role as {:role :session}, read from roles.tsv (columns:
   role, worktree-name, worktree-path, session, display, agent,
   receive-mode, idle-clear-flag)."
  []
  (if (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (map (fn [line]
                (let [fields (str/split line #"\t" -1)]
                  {:role (get fields 0) :session (get fields 3)})))
         (remove #(str/blank? (:session %))))
    []))

;; ── extension component ──────────────────────────────────────────────────────

(defn extension-healthy? []
  (:ok? (sh! extension-check-cmd)))

(defn bounce-extension! []
  (sh! extension-bounce-cmd))

;; ── agent-pane component ─────────────────────────────────────────────────────

(defn pane-alive?
  "A configured role's pane is healthy when its session exists and its pane
   has not exited (tmux's own pane_dead bookkeeping). A session that does
   not exist at all - the common case when its agent process crashed and
   nothing pins the pane open - reads as absent, same as a genuinely never-
   launched role; both need the identical repair (respawn from the
   persisted launch script)."
  [socket session]
  (let [result (process/sh {:continue true} "tmux" "-S" socket "list-panes" "-t" session
                            "-F" "#{pane_dead}")]
    (and (zero? (:exit result))
         (not (str/includes? (:out result) "1")))))

(defn respawn-role! [socket role session]
  (let [launch-script (fs/path state-dir "launch" (str role ".sh"))]
    (process/sh {:continue true} "tmux" "-S" socket "respawn-pane" "-k" "-t" session
                (str "zsh '" launch-script "'"))))

;; ── daemon component ─────────────────────────────────────────────────────────

(defn daemon-pid-file [] (fs/path state-dir "daemon" "handoffd.pid"))

(defn daemon-pid []
  (when (fs/exists? (daemon-pid-file))
    (parse-long (str/trim (slurp (str (daemon-pid-file)))))))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn daemon-healthy? []
  (pid-alive? (daemon-pid)))

(defn ensure-daemon! []
  (sh! supervisor-cmd))

;; ── orchestration (never aborts on one failed repair) ───────────────────────

(defn ensure-component!
  "Runs one component's check/repair/reclassify cycle. Exceptions during the
   probe or repair are caught so one component's failure can never prevent
   the remaining components from being checked."
  [name healthy?-fn repair!-fn repair-description]
  (try
    (let [before (boolean (healthy?-fn))]
      (if before
        {:component name :status :healthy}
        (do
          (try (repair!-fn) (catch Exception _ nil))
          (let [after (boolean (healthy?-fn))]
            {:component name
             :status (classify before after)
             :action repair-description}))))
    (catch Exception e
      {:component name :status :failed :action (str "probe error: " (.getMessage e))})))

(defn report-line [{:keys [component status action]}]
  (case status
    :healthy (str component ": HEALTHY")
    :fixed (str component ": FIXED (" action ")")
    :failed (str component ": FAILED"
                  (when action (str " (" action ")")))))

(defn -main []
  (let [socket (tmux-socket)
        extension-result (ensure-component! "extension" extension-healthy? bounce-extension!
                                             "bounced the extension dev host")
        role-results (if socket
                       (mapv (fn [{:keys [role session]}]
                               (ensure-component! (str "agent:" role)
                                                   #(pane-alive? socket session)
                                                   #(respawn-role! socket role session)
                                                   "respawned pane from its persisted launch script"))
                             (role-rows))
                       (mapv (fn [{:keys [role]}]
                               {:component (str "agent:" role) :status :failed
                                :action "no tmux socket found for this project root"})
                             (role-rows)))
        daemon-result (ensure-component! "daemon" daemon-healthy? ensure-daemon!
                                          "restarted the handoff daemon")
        results (concat [extension-result] role-results [daemon-result])]
    (doseq [r results] (println (report-line r)))
    (System/exit (if (some #(= :failed (:status %)) results) 1 0))))

(-main)
