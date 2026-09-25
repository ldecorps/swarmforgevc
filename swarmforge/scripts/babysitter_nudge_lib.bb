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

;; BL-1719 bounce (QA D1): mirrors agent_runtime_inject/capture-pane-text's
;; own guard - a blank/nil session must never reach tmux's `-t` (babashka's
;; process/sh turns a nil argv element into an empty string on the real
;; command line, and tmux's own empty `-t` falls back to an ARBITRARY
;; current/default session rather than erroring).
(defn capture-pane-text [socket session]
  (if (str/blank? session)
    ""
    (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session))))

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

;; 2026-09-21 (Claude Code, operator request): "never nudge an aider
;; coordinator" (the llama3.1:8b incident this repo already carries) - a
;; shell-run-script agent (aider) has no concept of "reply to this
;; message" distinct from "edit a file", so any injected nudge text reads
;; as a task and gets a hallucinated edit in response, regardless of
;; wording (agent_runtime_inject.bb's aider-no-narration-suffix already
;; helps, but does not reliably stop this for a nudge that names a
;; specific file and says "investigate and take action" - proven live
;; against the qwen2.5-coder mono-router coordinator, which produced a
;; fabricated ready_for_next.sh rewrite even with that suffix present).
;; Cheap for aider seats specifically: this pack already runs the
;; coordinator with --dry-run --no-auto-commits, so no code ever lands
;; from a hallucinated edit - but every such nudge still burns a full,
;; slow CPU-bound turn producing throwaway work instead of investigating
;; anything. Structural skip, not another wording attempt.
(defn aider-agent? [agent]
  (= :shell-run-script (:wake-style (agent-runtime-lib/capabilities agent))))

;; BL-1698 D2 (QA bounce 2026-09-25): a driver seat (BL-1697's
;; parcel-driver capability, prompt-engine-lib/parcel-driver-capable?)
;; must never be nudged either, on the same reasoning as aider-agent? -
;; the driver holds every step and types exactly one instruction per
;; turn (local_parcel_driver_lib.bb), so an injected nudge is a second,
;; unowned turn racing the driver's own. This is the capability flag
;; itself, not a provider-name check - a driver-capable seat with any
;; other :wake-style is still skipped.
(defn driver-seat? [agent]
  (prompt-engine-lib/parcel-driver-capable? agent))

(defn nudge-resident!
  "Verified inject of instruction text into a swarm role pane.
   Returns {:status :nudged|:skip-busy|:skip-aider-agent|:skip-driver-seat|:no-target|:no-session|:failed :detail ...}."
  [project-root role-name text & {:keys [log-fn]}]
  (let [text (str/trim (str text))
        log! (or log-fn (fn [& _] nil))]
    (cond
      (str/blank? text)
      {:status :failed :detail "empty message"}

      :else
      (if-let [target (resolve-nudge-target project-root role-name)]
        (let [{:keys [socket wake-session agent role]} target]
        (if (nil? wake-session)
          ;; BL-1719 bounce (QA D1): resolve-nudge-target's own
          ;; wake-session is nil outside a rotation-router pack when the
          ;; role has no session - a distinct, observable outcome, never
          ;; silently falling through to capture-pane-text/notify-agent!'s
          ;; own (also guarded) blank-session no-op.
          {:status :no-session :role role
           :detail (str "no session for " role-name " (" (:session target) ") outside a rotation-router pack")}
        (let [pane (try (capture-pane-text socket wake-session) (catch Exception _ ""))]
          (cond
            (aider-agent? agent)
            {:status :skip-aider-agent
             :role role
             :session wake-session
             :detail "aider seat — nudge withheld, not injected (see aider-agent? for why)"}

            (driver-seat? agent)
            {:status :skip-driver-seat
             :role role
             :session wake-session
             :detail "driver-capable seat — the local parcel driver owns this pane's turns (see driver-seat? for why)"}

            (pane-busy? pane)
            {:status :skip-busy
             :role role
             :session wake-session
             :detail "pane mid-turn (esc to interrupt) — retry when idle"}

            :else
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
                 :detail (.getMessage e)}))))))
        {:status :no-target
         :detail (str "no tmux socket or role \"" role-name "\" in roles.tsv")}))))

(defn format-cli-line [{:keys [status role session detail]}]
  (case status
    :nudged (str "NUDGED: " role " via " session)
    :skip-busy (str "SKIP_BUSY: " role " — " detail)
    :skip-aider-agent (str "SKIP_AIDER_AGENT: " role " — " detail)
    :skip-driver-seat (str "SKIP_DRIVER_SEAT: " role " — " detail)
    :no-target (str "NO_NUDGE: " detail)
    :failed (str "FAILED: " (or detail "unknown"))
    (str "FAILED: " (or detail "unknown"))))
