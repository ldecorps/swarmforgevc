;; respawn_bootstrap_lib.bb — hotfix 2026-09-09: a pane that is respawned
;; gets the SAME post-launch bootstrap its first launch got.
;;
;; Incident: the resident (aider/GLM) answered a wake with "I have no shell,
;; git, or filesystem tools in this session... I do not have those files."
;; That was true OF THAT SESSION. An aider seat's identity arrives only
;; through the post-launch tmux bootstrap (`/add constitution PIPELINE
;; roles/<role>.prompt`, then paste the composed prompt), which
;; swarmforge.sh runs at launch_role time only. Every later respawn -
;; `swarm ensure`'s single-role repair, and mono-router rotation
;; (rotate-resident-to!, both the resident-invoked and daemon-chase
;; drivers) - re-exec'd the launch script and stopped there, so the new
;; aider process began with an EMPTY chat: no role, no constitution, and no
;; way to know it may run shell commands. A claude seat hides the gap
;; because its launch script passes --append-system-prompt-file, so its
;; identity is in the process itself.
;;
;; This lib is pure: it locates the composed prompt and the compose sidecar
;; the launcher already writes, and builds the argv for the SAME
;; agent_runtime_cli.bb run-bootstrap verb swarmforge.sh invokes. No
;; provider is named here and no capability is re-derived: bootstrap-steps
;; yields no steps at all for :embedded providers (claude, cursor, codex),
;; so running it after every respawn is a no-op for them by construction.

(ns respawn-bootstrap-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def prompts-dir-name "prompts")
(def metadata-suffix ".metadata.json")

(defn prompt-file-path
  "The composed prompt the launcher wrote for this role."
  [state-dir role]
  (str (fs/path state-dir prompts-dir-name (str role ".md"))))

(defn metadata-file-path
  "The compose sidecar written beside it."
  [state-dir role]
  (str (prompt-file-path state-dir role) metadata-suffix))

(defn parse-compose-metadata
  "The two compose inputs the bootstrap's `/add` list depends on, read from
   the sidecar the launcher already writes. Anything unreadable degrades to
   the launcher's own defaults rather than refusing a bootstrap - a missing
   overlay costs one file in the /add list; a missing bootstrap costs the
   seat its whole identity."
  [text]
  (let [m (try (json/parse-string (str text) true) (catch Exception _ nil))
        m (when (map? m) m)]
    {:two-pack? (true? (get m (keyword "two-pack?")))
     :overlay-prompt (let [o (get m (keyword "overlay-prompt"))]
                       (if (string? o) o ""))}))

(defn bootstrap-argv
  "argv for agent_runtime_cli.bb's run-bootstrap verb - the same verb and
   argument order swarmforge.sh uses at launch. nil when the call cannot be
   made truthfully: no socket, no session, no agent, or no composed prompt
   on disk (a bootstrap that pastes a file that is not there would clear the
   pane's context and paste nothing)."
  [{:keys [scripts-dir socket session agent role prompt-file two-pack? overlay-prompt
           prompt-file-exists?]}]
  (when-not (or (str/blank? (str scripts-dir))
                (str/blank? (str socket))
                (str/blank? (str session))
                (str/blank? (str agent))
                (str/blank? (str role))
                (str/blank? (str prompt-file))
                (not prompt-file-exists?))
    ["bb" (str (fs/path scripts-dir "agent_runtime_cli.bb"))
     "run-bootstrap"
     (str socket) (str session) (str agent) (str role) (str prompt-file)
     (if two-pack? "1" "0")
     (or overlay-prompt "")]))

(defn argv-for-role
  "bootstrap-argv with the prompt file and its sidecar resolved off disk.
   `exists-fn` and `slurp-fn` are injected so the decision stays testable
   without a filesystem."
  [{:keys [scripts-dir state-dir socket session agent role]}
   & {:keys [exists-fn slurp-fn]
      :or {exists-fn (fn [p] (fs/exists? p))
           slurp-fn (fn [p] (try (slurp (str p)) (catch Exception _ nil)))}}]
  (let [prompt-file (prompt-file-path state-dir role)
        meta (parse-compose-metadata (slurp-fn (metadata-file-path state-dir role)))]
    (bootstrap-argv (merge {:scripts-dir scripts-dir
                            :socket socket
                            :session session
                            :agent agent
                            :role role
                            :prompt-file prompt-file
                            :prompt-file-exists? (boolean (exists-fn prompt-file))}
                           meta))))
