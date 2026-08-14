#!/usr/bin/env bb

;; BL-145 / full-stack ensure: `./swarm ensure` brings a swarm to a
;; known-good state in one idempotent command. It checks and repairs, in
;; order: the extension host, every configured agent pane (with that role's
;; remote-control health checked right after it - BL-514), the handoff
;; daemon, the operator runtime, babysitterd, and
;; (when Telegram is configured) the front-desk supervisor that owns the
;; Telegram bridge + Front Desk Bot.
;; Each component reports HEALTHY, FIXED (naming the repair), or FAILED -
;; never silently. A failed repair does not abort the remaining checks.
;; Exit status is non-zero if anything could not be brought to health.
;;
;; babysitterd (BL-611): the deterministic health-sweep daemon, managed like
;; every other daemon here — verify pid-alive, restart via
;; start_babysitterd.sh if not. Enabled by default (like operator/front-desk),
;; not gated on a prior "enabled" marker — the whole point of BL-611 is that
;; the sweep is wired into the swarm lifecycle rather than opt-in.
;;
;; Usage: swarm_ensure.bb <project-root>
;;
;; Decision logic (classify) is a pure function driven by injected
;; healthy-before?/healthy-after? booleans, mirroring
;; handoffd_supervisor.bb's evaluate-health - see test_swarm_ensure.sh for
;; the fake-probe unit tests and the fixture-driven integration scenarios.
;;
;; Env overrides (tests + ops):
;;   SWARM_ENSURE_EXTENSION_CHECK_CMD / SWARM_ENSURE_EXTENSION_BOUNCE_CMD
;;   SWARM_ENSURE_SUPERVISOR_CMD - the daemon repair command; defaults to
;;     start_handoff_daemon.sh (BL-690: a START action, never
;;     handoffd_supervisor.bb's --check-once probe, which can alarm-and-halt!)
;;   SWARM_ENSURE_OPERATOR_CMD / SWARM_ENSURE_FRONT_DESK_CMD
;;   SWARM_ENSURE_BABYSITTERD_CMD
;;   SWARM_ENSURE_RC_CMDLINE_CMD (BL-514) - substitutes the remote-control
;;     component's live-process probe; the real probe reads /proc/<pid>/cmdline,
;;     unavailable on a macOS dev/test host
;;   SWARMFORGE_SKIP_OPERATOR=1 / SWARMFORGE_SKIP_FRONT_DESK=1
;;   SWARMFORGE_SKIP_BABYSITTERD=1

(ns swarm-ensure
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "launch_contract_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_compat_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_respawn_env_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "remote_control_health_lib.bb")))

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
(def headless-marker-file (fs/path state-dir "headless-swarm"))
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

;; BL-690: this must be a START action, never a health PROBE.
;; `handoffd_supervisor.bb --check-once` is BL-144's own halt authority - on
;; a :dead/:stalled verdict it calls alarm-and-halt!, which kills every agent
;; tmux session. Wiring that probe up as ensure's "repair" meant a dead
;; daemon got alarmed-and-halted instead of started, tearing down panes
;; ensure had just respawned. start_handoff_daemon.sh is the same daemon-
;; start owner the launch paths already use (verify_daemon_lifecycle.sh's own
;; shape): it only ever starts handoffd + its supervisor, never touches
;; daemon/stop or a tmux session, and is idempotent (stops any pid-file
;; process first, so a second run never leaves two daemons behind).
(def supervisor-cmd
  (or (System/getenv "SWARM_ENSURE_SUPERVISOR_CMD")
      (str "bash " (fs/path script-dir "start_handoff_daemon.sh") " " project-root)))

(def operator-start-cmd
  (or (System/getenv "SWARM_ENSURE_OPERATOR_CMD")
      (str "bash " (fs/path script-dir "start_operator_runtime.sh") " " project-root)))

(def front-desk-start-cmd
  (or (System/getenv "SWARM_ENSURE_FRONT_DESK_CMD")
      (str "bash " (fs/path script-dir "launch_front_desk.sh") " " project-root)))

(def babysitterd-start-cmd
  (or (System/getenv "SWARM_ENSURE_BABYSITTERD_CMD")
      (str "bash " (fs/path script-dir "start_babysitterd.sh") " " project-root)))

;; BL-763: same idempotent-start contract as front-desk-start-cmd above -
;; start_cursor_bridge.sh already no-ops when its supervisor pid is alive.
(def cursor-bridge-start-cmd
  (or (System/getenv "SWARM_ENSURE_CURSOR_BRIDGE_CMD")
      (str "bash " (fs/path script-dir "start_cursor_bridge.sh") " " project-root)))

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

(defn rotation-router-mode?
  "True when this project is running (or last launched as) rotation router."
  []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      (str (fs/path project-root "swarmforge" "swarmforge.conf")))
        conf-text (when (and conf-path (fs/exists? conf-path))
                    (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

;; ── extension component ──────────────────────────────────────────────────────

(defn extension-healthy? []
  (:ok? (sh! extension-check-cmd)))

(defn bounce-extension! []
  (sh! extension-bounce-cmd))

;; ── agent-pane component ─────────────────────────────────────────────────────

(defn session-exists?
  "True when tmux has a session of this name on the project socket."
  [socket session]
  (zero? (:exit (process/sh {:continue true} "tmux" "-S" socket "has-session" "-t" session))))

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

(defn provider-respawn-env-args
  "BL-536: delegates to provider_respawn_env_lib.bb (extracted so
   handoffd.bb's auth-observe respawn path can reuse this SAME machinery
   without load-file'ing this whole script and its unconditional (-main)).
   Arity/behavior unchanged for every existing call site in this file."
  ([] (provider-respawn-env-args nil))
  ([role] (provider-respawn-env-lib/provider-respawn-env-args state-dir role)))

(defn respawn-role! [socket role session]
  (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
        env-args (provider-respawn-env-args role)
        cmd (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                    env-args
                    ["-t" session (str "zsh '" launch-script "'")])]
    (apply process/sh {:continue true} cmd)))

(defn create-session! [socket session]
  (process/sh {:continue true}
              "tmux" "-S" socket "new-session" "-d" "-s" session "-n" "swarm"))

(defn kill-session! [socket session]
  (process/sh {:continue true}
              "tmux" "-S" socket "kill-session" "-t" session))

(defn ensure-standing-role!
  "Create the session if missing, then respawn the launch script into it."
  [socket role session]
  (when-not (session-exists? socket session)
    (create-session! socket session)
    (Thread/sleep 250))
  (respawn-role! socket role session))

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

;; ── operator runtime + front-desk (Telegram bridge) ──────────────────────────

(defn operator-pid-file [] (fs/path state-dir "operator" "runtime.pid"))

(defn front-desk-pid-file [] (fs/path state-dir "operator" "front-desk-supervisor.pid"))

(defn babysitterd-pid-file [] (fs/path state-dir "babysitterd" "babysitterd.pid"))

;; BL-763: same pid-file-is-the-liveness-source-of-truth shape as front-desk
;; above - cursor_bridge_supervisor.bb exposes no other externally-callable
;; health predicate (its own --check-once is for start_cursor_bridge.sh's
;; own gave-up detection, not general liveness).
(defn cursor-bridge-pid-file [] (fs/path state-dir "operator" "cursor-bridge-supervisor.pid"))

(defn operator-pid []
  (when (fs/exists? (operator-pid-file))
    (parse-long (str/trim (slurp (str (operator-pid-file)))))))

(defn front-desk-pid []
  (when (fs/exists? (front-desk-pid-file))
    (parse-long (str/trim (slurp (str (front-desk-pid-file)))))))

(defn operator-healthy? []
  (pid-alive? (operator-pid)))

(defn front-desk-healthy? []
  (pid-alive? (front-desk-pid)))

(defn babysitterd-pid []
  (when (fs/exists? (babysitterd-pid-file))
    (parse-long (str/trim (slurp (str (babysitterd-pid-file)))))))

(defn babysitterd-healthy? []
  (pid-alive? (babysitterd-pid)))

(defn cursor-bridge-pid []
  (when (fs/exists? (cursor-bridge-pid-file))
    (parse-long (str/trim (slurp (str (cursor-bridge-pid-file)))))))

(defn cursor-bridge-healthy? []
  (pid-alive? (cursor-bridge-pid)))

(defn ensure-babysitterd! []
  (sh! babysitterd-start-cmd))

(defn ensure-operator! []
  (sh! operator-start-cmd))

(defn ensure-front-desk! []
  (sh! front-desk-start-cmd))

(defn ensure-cursor-bridge! []
  (sh! cursor-bridge-start-cmd))

(defn env-set? [name]
  (let [v (System/getenv name)]
    (and (some? v) (not (str/blank? v)))))

(defn telegram-configured?
  "Front desk needs the same three Telegram vars launch_front_desk.sh requires."
  []
  (and (env-set? "TELEGRAM_BOT_TOKEN")
       (env-set? "TELEGRAM_CHAT_ID")
       (env-set? "TELEGRAM_PRINCIPAL_USER_ID")))

(defn operator-enabled?
  []
  (not= "1" (System/getenv "SWARMFORGE_SKIP_OPERATOR")))

(defn front-desk-enabled?
  "Ensure front-desk when Telegram is configured, or a prior supervisor pid
   file exists (repair a previously launched desk). Explicit skip wins."
  []
  (and (not= "1" (System/getenv "SWARMFORGE_SKIP_FRONT_DESK"))
       (or (telegram-configured?)
           (fs/exists? (front-desk-pid-file)))))

(defn babysitterd-enabled?
  "Enabled by default, like operator/front-desk — BL-611's whole point is
   that the sweep is a standard managed daemon, not opt-in behind a marker."
  []
  (not= "1" (System/getenv "SWARMFORGE_SKIP_BABYSITTERD")))

;; BL-763: OR-token variant of telegram-configured? - start_cursor_bridge.sh
;; itself accepts CURSOR_BRIDGE_BOT_TOKEN OR TELEGRAM_BOT_TOKEN (the shared-
;; group-bot case), never requiring both.
;; BL-763: OR-token variant of telegram-configured? - start_cursor_bridge.sh
;; itself accepts CURSOR_BRIDGE_BOT_TOKEN OR TELEGRAM_BOT_TOKEN (the shared-
;; group-bot case), never requiring both.
(defn cursor-bridge-configured?
  []
  (and (or (env-set? "CURSOR_BRIDGE_BOT_TOKEN") (env-set? "TELEGRAM_BOT_TOKEN"))
       (env-set? "TELEGRAM_CHAT_ID")
       (env-set? "TELEGRAM_PRINCIPAL_USER_ID")))

(defn cursor-bridge-enabled?
  "Same shape as front-desk-enabled?: ensure when configured, or a prior
   supervisor pid file exists (repair a previously launched bridge).
   Explicit skip wins."
  []
  (and (not= "1" (System/getenv "SWARMFORGE_SKIP_CURSOR_BRIDGE"))
       (or (cursor-bridge-configured?)
           (fs/exists? (cursor-bridge-pid-file)))))

;; ── launch-contract component (BL-530) ──────────────────────────────────────
;; A pack that names a non-default coordinator_agent (aider, codex, ...) must
;; also declare its own coordinator_model and rotation, never inherit the
;; Claude-only defaults (BL-512 audit rank 3: a missing model/rotation reads
;; as a healthy pane while thrashing weakly). This has no automated repair -
;; the fix is a human editing the pack file - so it is reported directly as
;; HEALTHY/FAILED, never routed through ensure-component!'s repair-then-
;; reclassify cycle (mirroring the "no tmux socket" branch below).

(defn effective-conf-text []
  "BL-530 architect bounce, defect 2: an unreadable conf must never read as
   HEALTHY (nil conf-text -> launch-contract-violations returns [] ->
   'HEALTHY' is indistinguishable from 'I could not read the conf'). Reuses
   backlog-depth-lib/conf-file-path for the persisted-path resolution
   (project-root, not the caller's own cwd - the identical problem that
   sibling already solved). Unlike that sibling, which is content to degrade
   a genuinely absent config to a single numeric default, a broken-but-
   present persisted path here still falls through to the tracked default
   conf explicitly - the check must always evaluate something real rather
   than go silent, which a bare reuse of conf-file-path would not do for a
   persisted key that no longer resolves (it returns that same broken path,
   not the default)."
  (let [primary (backlog-depth-lib/conf-file-path project-root)
        fallback (apply fs/path project-root backlog-depth-lib/default-conf-relpath)]
    (or (try (slurp (str primary)) (catch Exception _ nil))
        (when (not= (str primary) (str fallback))
          (try (slurp (str fallback)) (catch Exception _ nil))))))

(defn launch-contract-result []
  (let [violations (launch-contract-lib/launch-contract-violations (effective-conf-text))]
    (if (empty? violations)
      {:component "launch-contract" :status :healthy}
      {:component "launch-contract" :status :failed
       :action (str/join "; " (map :detail violations))})))

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
      ;; BL-207: a genuine raw backend-failure detail (unlike the static
      ;; repair-description strings above, which describe the attempted
      ;; FIX, not why it failed) - the one place in this function worth
      ;; classifying into the stable Forge error taxonomy.
      (let [detail (str "probe error: " (.getMessage e))]
        {:component name :status :failed :action detail
         :category (:category (agent-runtime-lib/classify-provider-error detail))}))))

(defn ensure-role!
  "BL-530 architect bounce, defect 1: wraps ensure-component! for one
   agent pane with a deliberate exception to ensure's usual 'never abort on
   one failed repair' orchestration. When the swarm's launch contract is
   broken (missing coordinator_model/rotation for a pack that requires
   them - see launch-contract-result), respawning a dead pane would just
   restart it onto the same broken argv - the exact busy-idle thrash BL-512
   rank 3 describes, now reported as FIXED. Refusing the respawn is the
   point of this ticket, so a broken contract skips repair entirely for any
   pane that is not already alive; an already-healthy pane is left alone
   either way, since ensure never touches a pane that is already up."
  [name healthy?-fn respawn!-fn contract-broken?]
  (if (and contract-broken? (not (healthy?-fn)))
    {:component name :status :failed
     :action "respawn refused: launch contract broken - fix the pack conf, then rerun ensure"}
    (ensure-component! name healthy?-fn respawn!-fn
                        "respawned pane from its persisted launch script")))

(defn read-mono-router-active-role-marker
  "Contents of .swarmforge/mono-router-active-role, or nil."
  []
  (let [p (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? p)
      (str/trim (slurp (str p))))))

(defn rotate-target-launch-script [role]
  (fs/path state-dir "launch" (str role ".sh")))

(defn dormant-rotate-viable?
  "BL-537: a dormant rotate target must never blanket-report DORMANT without
   confirming rotate_to_role would actually succeed for it right now -
   mirroring rotate-resident-to!'s own two failure modes (no-resident-session,
   no-launch-script). SRE 2026-07-19: a session torn down alongside its
   resident left both silently unusable while ensure kept reporting DORMANT
   (indistinguishable from the healthy, by-design case). Probes (tmux, fs)
   stay here at the IO edge; the decision itself is mono-router-lib/rotate-viable?."
  [socket resident-session role]
  (mono-router-lib/rotate-viable?
   {:resident-alive? (boolean (and resident-session (pane-alive? socket resident-session)))
    :launch-script-present? (fs/exists? (rotate-target-launch-script role))}))

(defn ensure-mono-router-role!
  "BL-518 topology repair for one role under rotation router, merged with the
   BL-530 launch-contract refusal (ensure-role! above): a dormant rotate
   target is never respawned and never 'respawn refused' - contract-broken?
   only gates the branches that would actually attempt a respawn (:ok's
   dead-pane case and :ensure-standing), never the dormant or teardown-
   illicit decisions."
  [socket ordered-roles {:keys [role session]} contract-broken? resident-session]
  (let [alive (session-exists? socket session)
        action (mono-router-lib/topology-action ordered-roles role alive)
        class (mono-router-lib/classify-role ordered-roles role)
        class-name (name class)
        ;; Resident session name stays home (coder), but launch script follows
        ;; the durable active-role marker after rotate_to_role.
        launch-role (if (= class :resident)
                      (mono-router-lib/resident-launch-role
                       role (read-mono-router-active-role-marker))
                      role)
        component (str "agent:" role)
        refused {:component component :status :failed
                 :action "respawn refused: launch contract broken - fix the pack conf, then rerun ensure"}]
    (case action
      :ok
      (if (pane-alive? socket session)
        {:component component :status :healthy
         :action (str "mono-router " class-name
                      (when (and (= class :resident) (not= launch-role role))
                        (str " as " launch-role)))}
        (if contract-broken?
          refused
          (ensure-component! component
                             #(pane-alive? socket session)
                             #(ensure-standing-role! socket launch-role session)
                             (str "respawned dead mono-router " class-name " pane"
                                  (when (not= launch-role role)
                                    (str " as " launch-role))))))

      :dormant-ok
      (let [{:keys [viable? reason]} (dormant-rotate-viable? socket resident-session role)]
        (if viable?
          {:component component :status :dormant
           :action "mono-router rotate target; no standing session"}
          {:component component :status :failed
           :action (str "rotate_to_role would fail: " reason)}))

      :teardown-illicit
      (do
        (kill-session! socket session)
        (if (session-exists? socket session)
          {:component component :status :failed
           :action "could not tear down illicit standing session"}
          {:component component :status :fixed
           :action "tore down illicit standing session (mono-router dormant target)"}))

      :ensure-standing
      (if contract-broken?
        refused
        (ensure-component! component
                           #(pane-alive? socket session)
                           #(ensure-standing-role! socket launch-role session)
                           (str "restored mono-router " class-name " pane"
                                (when (not= launch-role role)
                                  (str " as " launch-role))))))))

;; ── remote-control (RC) component (BL-514) ──────────────────────────────────
;; Verifies each role's live claude process still carries the --remote-control
;; flag its launch script expects, right after that role's own agent:<role>
;; pane check. remote-control-health/classify separates four states; RC only
;; ever acts on :degraded (a live agent that lost its flag) - :down is left
;; entirely to the agent:<role> check (actionable? is true only for
;; :degraded), so a crashed pane is never double-respawned here, and
;; :off/:healthy need nothing.

(def rc-cmdline-cmd (System/getenv "SWARM_ENSURE_RC_CMDLINE_CMD"))

(defn rc-cmdline-fn
  "cmdline-fn for remote-control-health/check-role's injectable 5-arg arity.
   The real probe (remote-control-health/claude-cmdline-in-pane) reads
   /proc/<pid>/cmdline, which macOS dev/test hosts do not provide - tests
   substitute SWARM_ENSURE_RC_CMDLINE_CMD (a shell command run with socket
   and session as $1/$2; its stdout stands in for the live claude argv,
   blank output or non-zero exit standing in for no live process)."
  [socket session]
  (if rc-cmdline-cmd
    (let [{:keys [exit out]} (process/sh {:continue true} "sh" "-c" rc-cmdline-cmd "sh" socket session)]
      (when (and (zero? exit) (not (str/blank? (str/trim out))))
        (str/trim out)))
    (remote-control-health/claude-cmdline-in-pane socket session)))

(defn rc-launch-role
  "The role whose launch script currently governs this pane's RC identity.
   Under mono-router the resident keeps its home session name but may be
   running a different role's launch script after rotate_to_role - mirrors
   ensure-mono-router-role!'s own launch-role resolution. Checking RC against
   the wrong script would misclassify a legitimately rotated resident as
   :degraded and forcibly respawn it back to `role`. A blank/missing rotation
   marker (every non-router pack) leaves role unchanged."
  [ordered-roles role]
  (if (= :resident (mono-router-lib/classify-role ordered-roles role))
    (mono-router-lib/resident-launch-role role (read-mono-router-active-role-marker))
    role))

(defn rc-status [socket launch-role session]
  (:status (remote-control-health/check-role state-dir socket launch-role session rc-cmdline-fn)))

(defn respawn-rc-pane! [socket launch-role session]
  (let [launch (remote-control-health/launch-script-path state-dir launch-role)]
    (remote-control-health/respawn-role-pane! socket session (str launch))))

(defn ensure-rc-role!
  "role is the roles.tsv identity (used only for the reported component
   name); launch-role (rc-launch-role) is what is actually checked/repaired.
   Never probes the live process when the launch script carries no
   --remote-control flag at all - remote-control-health/classify checks
   `expected` before `actual`/`alive?`, so the result is unconditionally
   :off in that case regardless of what the probe would find. Skipping the
   probe there isn't just an optimization: the real probe walks the pane's
   full descendant process tree, and is worth avoiding whenever its result
   cannot change the outcome."
  [socket ordered role session]
  (let [launch-role (rc-launch-role ordered role)
        component (str "rc:" role)]
    (if (nil? (remote-control-health/expected-rc-name state-dir launch-role))
      {:component component :status :healthy}
      (let [status (rc-status socket launch-role session)]
        (cond
          (contains? #{:healthy :off} status)
          {:component component :status :healthy}

          (remote-control-health/actionable? status) ;; :degraded
          (ensure-component! component
                             #(contains? #{:healthy :off} (rc-status socket launch-role session))
                             #(respawn-rc-pane! socket launch-role session)
                             "respawned pane to restore --remote-control flag")

          :else ;; :down - the agent:<role> check's job
          {:component component :status :healthy})))))

(defn report-line [{:keys [component status action category]}]
  (case status
    :healthy (str component ": HEALTHY")
    :dormant (str component ": DORMANT" (when action (str " (" action ")")))
    :fixed (str component ": FIXED (" action ")")
    ;; BL-207: names the stable Forge error category alongside the raw
    ;; detail (never discarded) when one was classified, so an operator
    ;; scanning `./swarm ensure` output can tell "auth" from "unavailable"
    ;; from "unknown" at a glance, not just read provider-specific prose.
    :failed (str component ": FAILED"
                  (when category (str " [" (name category) "]"))
                  (when action (str " (" action ")")))))

(defn -main []
  (let [socket (tmux-socket)
        extension-result (if (fs/exists? headless-marker-file)
                           {:component "extension" :status :healthy
                            :action "skipped bounce (headless swarm owns tmux)"}
                           (ensure-component! "extension" extension-healthy? bounce-extension!
                                              "bounced the extension dev host"))
        ;; BL-530 architect bounce, defect 1: the launch-contract check must
        ;; be evaluated BEFORE any pane is respawned, not after, or a
        ;; broken contract only gets reported once ensure has already
        ;; respawned agents onto it.
        launch-contract-check (launch-contract-result)
        contract-broken? (= :failed (:status launch-contract-check))
        rows (role-rows)
        ordered (mapv :role rows)
        ;; BL-530 architect bounce (round 3): a live-shape fallback (some role
        ;; sessions standing, some absent) is equally the fingerprint of a
        ;; half-launched or partially-crashed classic pack — the exact
        ;; condition ensure exists to repair — so mono-router-ness is decided
        ;; ONLY by the declared conf/identity signal, never inferred from shape.
        router? (rotation-router-mode?)
        ;; BL-537: the resident's session name, looked up once so every
        ;; dormant role's rotate-viability check can confirm a live resident
        ;; to rotate onto exists - resident rows are processed first (roles.tsv
        ;; invariant: resident is the first non-coordinator entry), so by the
        ;; time a dormant role's turn comes any resident repair has already run.
        resident-session (some #(when (= :resident (mono-router-lib/classify-role ordered (:role %)))
                                   (:session %))
                                rows)
        role-results (if socket
                       (vec (mapcat (fn [{:keys [role session] :as row}]
                                      (let [agent-result
                                            (if router?
                                              (ensure-mono-router-role! socket ordered row contract-broken? resident-session)
                                              (ensure-role! (str "agent:" role)
                                                            #(pane-alive? socket session)
                                                            #(respawn-role! socket role session)
                                                            contract-broken?))
                                            rc-result (ensure-rc-role! socket ordered role session)]
                                        [agent-result rc-result]))
                                    rows))
                       (vec (mapcat (fn [{:keys [role]}]
                                      (let [detail "no tmux socket found for this project root"]
                                        [{:component (str "agent:" role) :status :failed
                                          :action detail
                                          :category (:category (agent-runtime-lib/classify-provider-error detail))}
                                         {:component (str "rc:" role) :status :healthy}]))
                                    rows)))
        daemon-result (ensure-component! "daemon" daemon-healthy? ensure-daemon!
                                          "restarted the handoff daemon")
        operator-result (when (operator-enabled?)
                          (ensure-component! "operator" operator-healthy? ensure-operator!
                                              "restarted the operator runtime"))
        front-desk-result (when (front-desk-enabled?)
                            (ensure-component! "front-desk" front-desk-healthy? ensure-front-desk!
                                                "restarted the Telegram front desk (bridge + bot)"))
        babysitterd-result (when (babysitterd-enabled?)
                             (ensure-component! "babysitterd" babysitterd-healthy? ensure-babysitterd!
                                                 "restarted babysitterd"))
        cursor-bridge-result (when (cursor-bridge-enabled?)
                                (ensure-component! "cursor-bridge" cursor-bridge-healthy? ensure-cursor-bridge!
                                                    "restarted the Cursor Remote bridge"))
        results (concat [extension-result] role-results [daemon-result launch-contract-check]
                        (remove nil? [operator-result front-desk-result babysitterd-result cursor-bridge-result]))]
    (doseq [r results] (println (report-line r)))
    (System/exit (if (some #(= :failed (:status %)) results) 1 0))))

(-main)
