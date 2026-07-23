;; Shared helpers for the inbox-facing handoff scripts (ready_for_next_task.bb,
;; done_with_current_task.bb, ready_for_next_batch.bb, done_with_current_batch.bb).
;; Loaded via load-file, not required on a classpath, so callers do:
;;   (load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
;; and refer to symbols as handoff-lib/foo.

(ns handoff-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str])
  (:import [java.nio.channels FileChannel]
           [java.nio.file OpenOption StandardOpenOption]))

(defn worktree-root
  "Handoff state lives at the worktree root even when invoked from a
   subdirectory; the daemon only delivers to worktree-root inboxes (BL-056).
   Falls back to the invocation cwd outside any git worktree."
  []
  (let [result (sh/sh "git" "rev-parse" "--show-toplevel")]
    (if (zero? (:exit result))
      (str/trim (:out result))
      (System/getProperty "user.dir"))))

(defn target-root
  "Resolves the target project's root, shared across every role's worktree,
   via git's common gitdir (stable from a linked worktree or the main
   checkout alike). Target-root-scoped state — roles.tsv, the daemon dir, and
   the BL-069 bounce-drain sentinel — lives here, distinct from the
   per-worktree handoff state under (worktree-root)."
  []
  (let [result (sh/sh "git" "rev-parse" "--git-common-dir")]
    (if (zero? (:exit result))
      (str (fs/parent (fs/absolutize (str/trim (:out result)))))
      (worktree-root))))

(defn bounce-drain-sentinel []
  (fs/path (target-root) ".swarmforge" "bounce-drain.json"))

(defn draining?
  "True while a BL-069 graceful bounce is draining the swarm: ready_for_next*
   must then refuse to dequeue NEW inbox/new items (in_process resumption is
   unaffected) so a role finishes its current handoff and goes idle instead
   of picking up more work."
  []
  (fs/exists? (bounce-drain-sentinel)))

(defn timestamp []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT
           (java.time.Instant/now)))

(defn id-timestamp []
  (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
           (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC)))

(defn handoff-files [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn batch-dirs [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn header-field [file field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?) (str/split-lines (slurp (str file)))))))

(defn header-value [file field default]
  (or (header-field file field) default))

(defn body [file]
  (let [[_ body] (str/split (slurp (str file)) #"\n\n" 2)]
    (or body "")))

(defn set-header! [file field value]
  (let [lines (str/split-lines (slurp (str file)))
        prefix (str field ": ")
        tmp (fs/create-temp-file {:dir (fs/parent file) :prefix ".headers."})
        result (loop [remaining lines
                      out []
                      inserted? false
                      replaced? false]
                 (if-let [line (first remaining)]
                   (cond
                     (and (not inserted?) (str/blank? line))
                     (recur (next remaining)
                            (conj (cond-> out (not replaced?) (conj (str prefix value))) line)
                            true
                            replaced?)

                     (and (not inserted?) (str/starts-with? line prefix))
                     (recur (next remaining) (conj out (str prefix value)) inserted? true)

                     :else
                     (recur (next remaining) (conj out line) inserted? replaced?))
                   (cond-> out
                     (and (not inserted?) (not replaced?)) (conj (str prefix value)))))]
    (spit (str tmp) (str (str/join "\n" result) "\n"))
    (fs/move tmp file {:replace-existing true})))

(defn fail! [status & lines]
  (binding [*out* *err*]
    (doseq [line lines]
      (println line)))
  (System/exit status))

;; BL-119: the chaser writes sidecar files (.nudge, .chase.json) next to a
;; queued handoff. Once the handoff itself completes/moves, an orphaned
;; sidecar can remain - these are the ONLY file kinds completion may ever
;; delete on its own; anything else still aborts with a clear error.
(def sidecar-suffixes [".nudge" ".chase.json" ".claim-progress.json"])

(defn sidecar-file? [path]
  (let [filename (fs/file-name path)]
    (boolean (some #(str/ends-with? filename %) sidecar-suffixes))))

(defn remove-sidecars-of!
  "Deletes <handoff-file>.nudge and <handoff-file>.chase.json if present -
   called right after a handoff moves out of a directory (new/ on dequeue,
   BL-232; in_process/ on completion), so its now-orphaned sidecars never
   linger at the handoff's old location to wedge later stuck-parcel checks."
  [handoff-file]
  (doseq [suffix sidecar-suffixes]
    (let [sidecar (fs/path (str (str handoff-file) suffix))]
      (when (fs/exists? sidecar)
        (fs/delete sidecar)))))

(defn clean-dir-sidecars-or-fail!
  "Called on whatever remains in a batch directory once every real .handoff
   payload has already been moved out. Any leftover chaser sidecar is
   disposable metadata and is deleted; any other unexpected file aborts
   completion, naming it, without deleting anything."
  [dir]
  (when (fs/exists? dir)
    (doseq [entry (fs/list-dir dir)]
      (if (and (fs/regular-file? entry) (sidecar-file? entry))
        (fs/delete entry)
        (fail! 2 (str "AMBIGUOUS_TASK_STATE: unexpected file in batch directory: " entry))))))

(defn current-role []
  (let [r (System/getenv "SWARMFORGE_ROLE")]
    (when-not (str/blank? r) r)))

;; ── BL-128: the one shared, role-keyed mailbox path resolver ────────────────
;; Coordinator and specifier both run on the shared `master` worktree
;; (roles.tsv worktree-name "master" for both), so they used to share one
;; physical .swarmforge/handoffs/ directory - separated only by the logical
;; `recipient:` header filter (mine? below), a patch over a genuinely shared
;; resource that produced real cross-role dequeue/dead-letter incidents.
;;
;; Every mailbox-path caller (the daemon, the queue helpers, the chaser via
;; handoffd.bb, dead-letter tooling, salvage/reroute/redo scripts) must go
;; through mailbox-dir/mailbox-base-dir - no duplicated path-construction
;; logic anywhere. Roles with their own dedicated worktree already have
;; physical separation and keep their existing flat layout; only
;; worktree-name "master" gets the extra <role> subdirectory.

(defn- mailbox-state->relative-segments
  "The inbox/... vs top-level segment path for one mailbox state. :abandoned
   is salvage_lib.bb's own fifth inbox state (redo/reroute's stale-item
   parking dir), alongside new/in_process/completed."
  [state]
  (case state
    :outbox     ["outbox"]
    :sent       ["sent"]
    :failed     ["failed"]
    :new        ["inbox" "new"]
    :in_process ["inbox" "in_process"]
    :completed  ["inbox" "completed"]
    :abandoned  ["inbox" "abandoned"]))

(defn mailbox-base-dir
  "The <worktree-path>/.swarmforge/handoffs[/<role>] base a role's mailbox
   lives under - the <role> subdirectory only for master-resident roles
   (worktree-name \"master\"), since only they share one physical checkout;
   every other role's own dedicated worktree already provides physical
   separation, so it keeps the pre-BL-128 flat layout unchanged."
  [role-info]
  (if (= (:worktree-name role-info) "master")
    (fs/path (:worktree-path role-info) ".swarmforge" "handoffs" (:role role-info))
    (fs/path (:worktree-path role-info) ".swarmforge" "handoffs")))

(defn mailbox-dir
  "The physical mailbox directory for role-info in a given state
   (:outbox :sent :failed :new :in_process :completed :abandoned) - the ONE
   shared resolver every mailbox-path caller must go through (BL-128)."
  [role-info state]
  (apply fs/path (mailbox-base-dir role-info) (mailbox-state->relative-segments state)))

(defn load-role-info
  "Reads role-name's own roles.tsv row into the same {:role :worktree-name
   :worktree-path :session :display :agent :receive-mode} shape
   handoffd.bb's load-roles produces, so every script shares one role-info
   shape. nil when roles.tsv or the row is absent. The 2-arity form takes an
   explicit project root (salvage_lib.bb/handoffd_supervisor.bb's callers
   already receive one from their own caller) instead of re-deriving it via
   git-common-dir."
  ([role-name] (load-role-info role-name (target-root)))
  ([role-name root]
   (let [tsv (fs/path root ".swarmforge" "roles.tsv")]
     (when (and role-name (fs/exists? tsv))
       (some (fn [line]
               (let [[role worktree-name worktree-path session display agent receive-mode]
                     (str/split line #"\t")]
                 (when (= role role-name)
                   {:role role :worktree-name worktree-name :worktree-path worktree-path
                    :session session :display display :agent agent
                    :receive-mode (or receive-mode "task")})))
             (remove str/blank? (str/split-lines (slurp (str tsv)))))))))

(defn load-all-roles
  "Every role's role-info, in roles.tsv order - for callers (salvage_lib.bb,
   handoffd_supervisor.bb) that need to iterate every role's own mailbox
   rather than look up a single one. Iterating per ROLE (not deduped
   worktree path) is what correctly visits master-resident roles' now-
   distinct per-role subdirectories instead of double-scanning (or
   under-scanning) one shared directory. The 1-arity form takes an explicit
   project root, same rationale as load-role-info above."
  ([] (load-all-roles (target-root)))
  ([root]
   (let [tsv (fs/path root ".swarmforge" "roles.tsv")]
     (if (fs/exists? tsv)
       (vec (for [line (remove str/blank? (str/split-lines (slurp (str tsv))))
                  :let [[role worktree-name worktree-path session display agent receive-mode]
                        (str/split line #"\t")]]
              {:role role :worktree-name worktree-name :worktree-path worktree-path
               :session session :display display :agent agent
               :receive-mode (or receive-mode "task")}))
       []))))

(defn my-mailbox-base-dir
  "This process's own mailbox base dir, resolved via SWARMFORGE_ROLE +
   roles.tsv when both are available; falls back to the pre-BL-128 flat
   worktree-root layout otherwise (e.g. invoked outside a live swarm),
   preserving prior behavior for that case."
  []
  (if-let [role-info (load-role-info (current-role))]
    (mailbox-base-dir role-info)
    (fs/path (worktree-root) ".swarmforge" "handoffs")))

(defn my-mailbox-dir
  "This process's own mailbox directory in the given state - the queue
   helpers' (ready_for_next*/done_with_current*) single point of entry,
   replacing the old inbox-dir + manual \"new\"/\"in_process\"/\"completed\"
   joins at each call site."
  [state]
  (apply fs/path (my-mailbox-base-dir) (mailbox-state->relative-segments state)))

(defn mine?
  "True when this handoff's recipient matches the current role. Roles that share
   a worktree (e.g. coordinator + specifier on master) share one physical inbox,
   so filter by the recipient header the daemon stamps. Untagged files and an
   unset role fall through unchanged, preserving prior behavior."
  [file]
  (let [role (current-role)
        recipient (header-field file "recipient")]
    (or (nil? role) (nil? recipient) (= recipient role))))

(defn my-handoff-files [dir]
  (vec (filter mine? (handoff-files dir))))

;; ── BL-218: mailbox intake idempotency ──────────────────────────────────
;; ready_for_next_task.bb/ready_for_next_batch.bb historically only checked
;; whether a target in_process file already existed (AMBIGUOUS_TASK_STATE);
;; neither ever checked whether the SAME handoff (by basename) was already
;; terminal in completed/ or abandoned/. A stale duplicate lingering in
;; new/ - e.g. surfaced by the BL-128 migration window's flat<->per-role
;; layout fallback - was resurrected as brand-new work with a fresh
;; dequeued_at. dedup-new-candidates is pure over already-listed basenames
;; (fixtures in tests, real fs/file-name output in production) so intake
;; can refuse to resurrect a terminal handoff without doing its own I/O -
;; and the guard holds no matter which physical layout (flat or per-role)
;; my-mailbox-dir resolved the three directories from.

(defn already-terminal?
  "True when basename already appears among completed-basenames or
   abandoned-basenames - the two states a handoff, once reached, must
   never leave."
  [basename completed-basenames abandoned-basenames]
  (boolean (or (contains? (set completed-basenames) basename)
               (contains? (set abandoned-basenames) basename))))

;; BL-499 (cleaner, DRY): the `(map fs/file-name (handoff-files dir))` step
;; every already-terminal? caller repeats to turn a completed/ or
;; abandoned/ directory into a comparable basename set - lifted out of
;; ready_for_next_task.bb/ready_for_next_batch.bb's own dequeue-time dedup
;; (BL-218) and chase_sweep_lib.bb's sweep-time reap (BL-499) into ONE
;; shared reader so a future caller of already-terminal?/dedup-new-
;; candidates never re-derives it a fourth way. A non-existent directory (a
;; role whose completed/abandoned has never been created yet) already
;; degrades to [] via handoff-files.
(defn terminal-basenames [dir]
  (set (map fs/file-name (handoff-files dir))))

(defn dedup-new-candidates
  "Splits new-dir candidate file paths (already sorted; mine? already
   applied by the caller for task mode) into :skipped (basename already
   terminal - must not be resurrected) and :dequeueable (genuinely new),
   preserving order. Builds the terminal-basename set once up front rather
   than calling already-terminal? (which re-builds both sets from scratch)
   per candidate - O(n+m) instead of O(n*m) for n candidates and m
   completed/abandoned basenames."
  [new-files completed-basenames abandoned-basenames]
  (let [merged-terminal-basenames (into (set completed-basenames) abandoned-basenames)
        terminal? (fn [f] (contains? merged-terminal-basenames (fs/file-name f)))]
    {:skipped (vec (filter terminal? new-files))
     :dequeueable (vec (remove terminal? new-files))}))

(defn roles-tsv-path []
  (fs/path (target-root) ".swarmforge" "roles.tsv"))

(defn idle-clear-enabled?
  "True when role-name's roles.tsv row carries the BL-089 idle-clear token
   ('on') in the 8th (optional) column. Absent column, absent row, or any
   other value means off — matches the ticket's opt-in, default-off design."
  [role-name]
  (boolean
    (when (and role-name (fs/exists? (roles-tsv-path)))
      (some (fn [line]
              (let [fields (str/split line #"\t" -1)]
                (when (= role-name (first fields))
                  (= "on" (get fields 7)))))
            (str/split-lines (slurp (str (roles-tsv-path))))))))

(defn handoff-body-lead
  "Preamble prepended to git_handoff / note / rule_proposal parcel bodies.

   Claude agents (BL-519) already carry constitution + PIPELINE + role in
   --append-system-prompt-file at launch/respawn. The legacy 'Re-read your
   role and constitution' line invites a duplicate Read into conversation
   history — especially on mono-router, where rotate_to_role.sh respawns
   with a fresh system prefix right before ready_for_next picks up the parcel.

   Agents that still bootstrap via tmux file injection (aider, grok) keep the
   reminder."
  ([recipients] (handoff-body-lead recipients (target-root)))
  ([recipients root]
   (let [agents (vec (keep #(some-> (load-role-info % root) :agent str/trim)
                           recipients))]
     (if (and (seq agents)
              (every? #(= "claude" %) agents))
       ""
       "Re-read your role and constitution.\n\n"))))

(defn tmux-socket []
  (str/trim (slurp (str (fs/path (target-root) ".swarmforge" "tmux-socket")))))

(defn launch-script-path [role-name]
  (str (fs/path (target-root) ".swarmforge" "launch" (str role-name ".sh"))))

(defn openrouter-pane-env-args
  "BL-130 ephemeral -e injection for launch_role / chase / ensure / rotate.
   Must not drop OpenRouter/OpenAI/Mistral/Cerebras/Perplexity/Gemini/Qwen auth on respawn.
   When SWARMFORGE_USE_CEREBRAS=1, SWARMFORGE_USE_PERPLEXITY=1, or SWARMFORGE_USE_QWEN=1,
   that provider key wins for OPENAI_* (host OPENAI_API_KEY must not shadow the compat path).
   Gemini: GEMINI_API_KEY, or SWARMFORGE_GEMINI_API_KEY mapped to GEMINI_API_KEY.
   Qwen: QWEN_API_KEY, or BAILIAN_CODING_PLAN_API_KEY mapped to QWEN_API_KEY."
  []
  (let [use-cerebras (= "1" (System/getenv "SWARMFORGE_USE_CEREBRAS"))
        use-perplexity (= "1" (System/getenv "SWARMFORGE_USE_PERPLEXITY"))
        use-qwen (= "1" (System/getenv "SWARMFORGE_USE_QWEN"))
        cerebras (System/getenv "CEREBRAS_API_KEY")
        perplexity (System/getenv "PERPLEXITY_API_KEY")
        qwen (let [q (System/getenv "QWEN_API_KEY")]
               (if (str/blank? q)
                 (System/getenv "BAILIAN_CODING_PLAN_API_KEY")
                 q))
        gemini (let [g (System/getenv "GEMINI_API_KEY")]
                 (if (str/blank? g)
                   (System/getenv "SWARMFORGE_GEMINI_API_KEY")
                   g))
        openai (cond
                 (and use-cerebras (not (str/blank? cerebras))) cerebras
                 (and use-perplexity (not (str/blank? perplexity))) perplexity
                 (and use-qwen (not (str/blank? qwen))) qwen
                 :else (System/getenv "OPENAI_API_KEY"))
        openai-base (cond
                      (and use-cerebras (not (str/blank? cerebras))) "https://api.cerebras.ai/v1"
                      (and use-perplexity (not (str/blank? perplexity))) "https://api.perplexity.ai"
                      (and use-qwen (not (str/blank? qwen))) "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
                      :else (System/getenv "OPENAI_API_BASE"))
        openai-base-url (cond
                          (and use-cerebras (not (str/blank? cerebras))) "https://api.cerebras.ai/v1"
                          (and use-perplexity (not (str/blank? perplexity))) "https://api.perplexity.ai"
                          (and use-qwen (not (str/blank? qwen))) "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
                          :else (System/getenv "OPENAI_BASE_URL"))]
    (cond-> []
      (not (str/blank? (System/getenv "OPENROUTER_API_KEY")))
      (concat ["-e" (str "OPENROUTER_API_KEY=" (System/getenv "OPENROUTER_API_KEY"))])
      (not (str/blank? (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS")))
      (concat ["-e" (str "CLAUDE_CODE_MAX_OUTPUT_TOKENS=" (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))])
      (not (str/blank? (System/getenv "MISTRAL_API_KEY")))
      (concat ["-e" (str "MISTRAL_API_KEY=" (System/getenv "MISTRAL_API_KEY"))])
      (not (str/blank? cerebras))
      (concat ["-e" (str "CEREBRAS_API_KEY=" cerebras)])
      (not (str/blank? perplexity))
      (concat ["-e" (str "PERPLEXITY_API_KEY=" perplexity)])
      (not (str/blank? qwen))
      (concat ["-e" (str "QWEN_API_KEY=" qwen)])
      (not (str/blank? gemini))
      (concat ["-e" (str "GEMINI_API_KEY=" gemini)])
      use-cerebras
      (concat ["-e" "SWARMFORGE_USE_CEREBRAS=1"])
      use-perplexity
      (concat ["-e" "SWARMFORGE_USE_PERPLEXITY=1"])
      use-qwen
      (concat ["-e" "SWARMFORGE_USE_QWEN=1"])
      (not (str/blank? openai))
      (concat ["-e" (str "OPENAI_API_KEY=" openai)])
      (not (str/blank? openai-base))
      (concat ["-e" (str "OPENAI_API_BASE=" openai-base)])
      (not (str/blank? openai-base-url))
      (concat ["-e" (str "OPENAI_BASE_URL=" openai-base-url)]))))

(defn parse-mono-router-resident-session
  "Pure: first non-coordinator session column from roles.tsv text."
  [roles-tsv-text]
  (some (fn [line]
          (let [fields (str/split line #"\t" -1)
                role (first fields)
                session (get fields 3)]
            (when (and role (not= "coordinator" role) (not (str/blank? session)))
              session)))
        (str/split-lines (or roles-tsv-text ""))))

(defn mono-router-resident-session
  "Standing pipeline pane under config rotation router: first non-coordinator
   roles.tsv session (packs pin home as coder → swarmforge-coder). Never use
   bare `tmux display-message` without -t — headless shells resolve the wrong
   pane (or none), so rotate_to_role.sh can print success while leaving the
   resident on the old role."
  []
  (when (fs/exists? (roles-tsv-path))
    (parse-mono-router-resident-session (slurp (str (roles-tsv-path))))))

(defn mono-router-home-role
  "First non-coordinator role in roles.tsv — mono-router resident home identity."
  []
  (when (fs/exists? (roles-tsv-path))
    (some (fn [line]
            (let [role (first (str/split line #"\t" -1))]
              (when (and role (not= "coordinator" role) (not (str/blank? role)))
                role)))
          (str/split-lines (slurp (str (roles-tsv-path)))))))

(defn mono-router-active-role-path
  "Durable identity of whoever the resident pane is currently running as.
   Chase uses this so a dormant-role wake rotates instead of false-waking
   coder while cleaner mail sits unclaimed."
  []
  (fs/path (target-root) ".swarmforge" "mono-router-active-role"))

(defn write-mono-router-active-role!
  [role]
  (when-not (str/blank? role)
    (let [p (mono-router-active-role-path)]
      (fs/create-dirs (fs/parent p))
      (spit (str p) (str role "\n")))))

(defn read-mono-router-active-role
  "Current resident identity, or home role when the marker is missing."
  []
  (let [p (mono-router-active-role-path)]
    (or (when (fs/exists? p)
          (let [v (str/trim (slurp (str p)))]
            (when-not (str/blank? v) v)))
        (mono-router-home-role)
        "coder")))

(defn session-exists?
  "True when tmux has a live session of this name on the project socket."
  [socket session]
  (and (not (str/blank? socket))
       (not (str/blank? session))
       (zero? (:exit (sh/sh "tmux" "-S" socket "has-session" "-t" session)))))

(defn resolve-wake-session
  "Pure wake target for a roles.tsv session name under mono-router.
   Prefer the configured session when it exists; otherwise remap to the
   resident pane when that exists. Keeps the configured name when nothing
   stands so the caller still sees a real tmux failure."
  [{:keys [configured-session configured-exists? resident-session resident-exists?]}]
  (cond
    configured-exists? configured-session
    (and (not (str/blank? resident-session)) resident-exists?) resident-session
    :else configured-session))

(defn wake-session
  "Session that should receive a tmux wake for a roles.tsv session name.
   Under mono-router / sequential rotation, dormant pipeline roles keep their
   own session names in roles.tsv but have no standing pane — only the
   resident (plus coordinator) exists. Waking the missing name fails with
   `tmux send-literal failed` and falsely marks parcels failed even when the
   mailbox copy landed. Remap missing sessions to the resident when present."
  [socket configured-session]
  (let [resident (mono-router-resident-session)]
    (resolve-wake-session
     {:configured-session configured-session
      :configured-exists? (session-exists? socket configured-session)
      :resident-session resident
      :resident-exists? (boolean (and resident (session-exists? socket resident)))})))

(defn pane-id
  "Prefer an explicit -t target. Bare display-message is only a last resort."
  ([socket] (pane-id socket nil))
  ([socket session]
   (let [args (cond-> ["tmux" "-S" socket "display-message" "-p" "#{pane_id}"]
                (not (str/blank? session)) (concat ["-t" session]))
         result (apply sh/sh args)]
     (str/trim (:out result)))))

(defn respawn-self!
  "Respawns this role's own tmux pane at the idle boundary (BL-089), running
   the same launch script a fresh pane launch would run so the new session
   gets the full role re-bootstrap. Mirrors the coordinator's manual
   respawn-pane procedure, but self-triggered from inside the pane being
   replaced instead of from an operator pane."
  [role-name]
  (let [socket (tmux-socket)
        session (or (mono-router-resident-session) (pane-id socket))
        script (launch-script-path role-name)
        env-args (openrouter-pane-env-args)
        result (apply sh/sh (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                                    env-args
                                    ["-t" session (str "zsh '" script "'")]))]
    (when (zero? (:exit result))
      (write-mono-router-active-role! role-name))
    result))

;; ── BL-518: mono-router rotation ────────────────────────────────────────────
;; respawn-self! re-execs the CURRENT role's launch script (idle-boundary
;; refresh). respawn-as! re-execs a DIFFERENT role's launch script in the same
;; pane: the resident mono-router agent becomes the next pipeline role, and
;; because each role's <role>.sh bakes in its own --settings (model + effort),
;; the model actually changes for that stage - the one thing in-process
;; ('rotation sequential') rotation cannot do.
(defn wait-for-delivery!
  "Blocks until handoffd has delivered a parcel into <role>'s inbox/new (or it
   is already in_process), up to timeout-ms. Returns true if a parcel is there,
   false on timeout. The resident pane is the ONLY standing session under
   router rotation, so a dormant role respawned to an empty inbox would idle
   with nothing able to poke it - we confirm the parcel landed before rotating."
  [role timeout-ms]
  (let [role-info (load-role-info role)
        dirs (when role-info
               [(mailbox-dir role-info :new) (mailbox-dir role-info :in_process)])
        has-parcel? (fn []
                      (some (fn [d]
                              (and d (fs/exists? d)
                                   (some #(let [nm (str (fs/file-name %))]
                                            (or (str/ends-with? nm ".handoff")
                                                (str/starts-with? nm "batch_")))
                                         (fs/list-dir d))))
                            dirs))
        deadline (+ (System/currentTimeMillis) timeout-ms)]
    (loop []
      (cond
        (has-parcel?) true
        (>= (System/currentTimeMillis) deadline) false
        :else (do (Thread/sleep 500) (recur))))))

(defn rotate-resident-to!
  "Rotate the resident pane to <target-role>. Returns {:ok true} or
   {:ok false :reason ...}. Never System/exit — safe for handoffd chase."
  [target-role]
  (try
    (let [socket (tmux-socket)
          session (or (mono-router-resident-session) (pane-id socket))
          script (launch-script-path target-role)
          env-args (openrouter-pane-env-args)]
      (cond
        (str/blank? session)
        {:ok false :reason "no-resident-session"}
        (not (fs/exists? script))
        {:ok false :reason "no-launch-script"}
        :else
        (do
          (when-not (wait-for-delivery! target-role 30000)
            (binding [*out* *err*]
              (println (str "rotate: WARNING no parcel delivered to '" target-role
                            "' within 30s; rotating anyway (it will resume via RESUME-ON-START if it arrives).")))
            (flush))
          (let [result (apply sh/sh (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                                            env-args
                                            ["-t" session (str "zsh '" script "'")]))]
            (if (zero? (:exit result))
              (do (write-mono-router-active-role! target-role)
                  {:ok true})
              {:ok false :reason (or (not-empty (str/trim (str (:err result))))
                                     (str "tmux-exit-" (:exit result)))})))))
    (catch Exception e
      {:ok false :reason (.getMessage e)})))

(defn respawn-as!
  "Rotate the resident pane to <target-role>, running that role's own launch
   script (its tailored model/effort). Waits for the parcel to be delivered to
   target-role first (best-effort; proceeds after timeout with a loud warning
   so a fresh role never boots to an inbox handoffd merely hasn't reached yet).
   The target role's launch script must already exist - the router-mode
   launcher pre-generates every pipeline role's <role>.sh at startup."
  [target-role]
  (let [result (rotate-resident-to! target-role)]
    (when-not (:ok result)
      (binding [*out* *err*]
        (case (:reason result)
          "no-resident-session"
          (println "rotate: could not resolve mono-router resident session")
          "no-launch-script"
          (println (str "rotate: no launch script for role '" target-role
                        "' - is this swarm a mono-router (config rotation router) launch?"))
          (println (str "rotate: failed for '" target-role "': " (:reason result)))))
      (System/exit (case (:reason result)
                     "no-resident-session" 4
                     "no-launch-script" 3
                     1)))
    result))

;; ── BL-365: durable install ──────────────────────────────────────────────
;; A bare `spit` + `fs/move` pair is atomic in ORDERING (the rename is one
;; syscall) but not in DURABILITY: `spit` does not fsync, so the file's
;; content can still be sitting in the OS page cache, never written to the
;; physical device, when a crash/power-loss/WSL-restart happens. The
;; directory entry (from the rename) can reach stable storage while the
;; data blocks it points at never do, leaving a correctly-named, zero-length
;; file that was "written atomically" - exactly the incident this ticket
;; exists to fix. write-fn!/sync-fn!/rename-fn! are injectable so a test can
;; assert the ORDER (write, then sync, then rename) without a real crash -
;; the "honest mechanical proof" the ticket asks for; production always
;; uses the real defaults.
(defn- fsync-file!
  "The standard Java fsync idiom (FileChannel.force) - not
   FileDescriptor.sync, which Babashka's sandbox does not permit calling
   reflectively."
  [path]
  (with-open [ch (FileChannel/open path (into-array OpenOption [StandardOpenOption/WRITE]))]
    (.force ch true)))

(defn atomic-write!
  ([target content] (atomic-write! target content {}))
  ([target content {:keys [write-fn! sync-fn! rename-fn!]
                     :or {write-fn! (fn [tmp content] (spit (str tmp) content))
                          sync-fn! (fn [tmp] (fsync-file! (.toPath (java.io.File. (str tmp)))))
                          rename-fn! (fn [tmp target]
                                       (fs/move tmp target {:replace-existing true :atomic-move true}))}}]
   (fs/create-dirs (fs/parent target))
   (let [tmp (fs/path (fs/parent target) (str "." (fs/file-name target) "." (System/nanoTime) ".tmp"))]
     (write-fn! tmp content)
     (sync-fn! tmp)
     (rename-fn! tmp target)
     target)))

;; ── BL-365: corrupt-handoff detection + quarantine ──────────────────────────
;; A handoff file that is empty, truncated mid-header (missing one of the
;; required envelope fields), or has headers but no body must never be
;; promoted as work - there is nothing in it for a role to act on, and the
;; swarm's own stuck/chase sweeps are blind to this failure mode (the mail
;; moved perfectly; it just carried nothing). This is a cheap STRUCTURAL
;; check ("does this parse into a real handoff envelope at all?"),
;; categorically different from - and not a substitute for - a second
;; semantic validation pass over header VALUES, which the handoff protocol
;; deliberately declines in the daemon and stays the sender's own job
;; (swarm_handoff.bb's validate). Do not "simplify" this check away into
;; the existing missing-field validation - it must fire even when every
;; individually-checked field happens to be present but the file is
;; otherwise corrupt (e.g. headers with no body at all).
;;
;; Deliberately NOT "id": id is audit-only metadata (collision-proofing
;; across worktrees, never read by delivery/dequeue routing), not something
;; the pipeline actually needs to act on a handoff - and several existing
;; tests already hand-craft minimal fixture handoffs that omit it, same as
;; a real operator-authored note might. Requiring it here would flag those
;; as corrupt for a reason that has nothing to do with dispatchability.
(def required-envelope-headers ["from" "to" "priority" "type"])

(defn parse-envelope
  "Splits handoff file content into its header map and body. Shared by
   corrupt-handoff? here and by handoffd.bb's parse-message (which slurps a
   path and adds :content) - both need the identical header-block/body
   split, so this is the one place it lives. A header line with a blank
   value is kept as-is rather than filtered here: corrupt-handoff? below
   already treats a missing key and a blank-value key identically via
   str/blank?, so filtering here would be redundant, not stricter."
  [content]
  (let [[header body] (str/split content #"\n\n" 2)
        headers (into {}
                      (for [line (str/split-lines (or header ""))
                            :let [[k v] (str/split line #": " 2)]
                            :when (and k v)]
                        [k v]))]
    {:headers headers :body (or body "")}))

(defn corrupt-handoff?
  "True when content structurally cannot be a real handoff: empty, missing
   one of the required envelope headers (covers a truncated-mid-header
   file), or has no body at all (covers a headers-with-no-body file)."
  [content]
  (or (str/blank? content)
      (let [{:keys [headers body]} (parse-envelope content)]
        (or (boolean (some #(str/blank? (get headers %)) required-envelope-headers))
            (str/blank? body)))))

;; BL-365 Scenario 03: "a sender cannot install an empty handoff into its
;; outbox" - the sender's OWN integrity floor. Durably writes content
;; (atomic-write!), then re-reads what actually LANDED ON DISK (never trusts
;; the in-memory content - the write path, or the disk under it, is the
;; untrusted part) and deletes it on any corruption, so a failed write never
;; leaves a file behind for anything downstream to pick up. write-opts flows
;; straight through to atomic-write!'s own injectable write-fn!/sync-fn!/
;; rename-fn! seam, so a test can force a "contents fail to be written" case
;; deterministically (a write-fn! that installs nothing) rather than needing
;; a real crash or a filesystem permission-bit trick.
(defn install-handoff!
  ([target content] (install-handoff! target content {}))
  ([target content write-opts]
   (atomic-write! target content write-opts)
   (if (corrupt-handoff? (slurp (str target)))
     (do (fs/delete-if-exists target) nil)
     target)))

(defn quarantine-corrupt-handoff!
  "Renames a corrupt handoff file in place to the SAME dead-letter suffix
   chase_sweep_lib.bb already uses for stuck mail (<name>.handoff.dead) -
   reusing the existing dead-letter scan/notify path (notify-dead-letters.js,
   which already alerts a human over Telegram for any *.handoff.dead in
   inbox/new/) rather than inventing a new quarantine mechanism, so a
   quarantined parcel is surfaced the same way a stuck one already is.
   Returns the new path."
  [file]
  (let [dead-path (fs/path (fs/parent file) (str (fs/file-name file) ".dead"))]
    (fs/move file dead-path {:replace-existing false})
    dead-path))

(defn partition-corrupt
  "Splits already-dequeueable candidate files into :corrupt (quarantined in
   place as a side effect - never left for a later sweep to resurrect) and
   :valid (untouched, still eligible to dequeue). Callers must never
   promote a :corrupt candidate into in_process/."
  [candidate-files]
  (loop [remaining candidate-files corrupt [] valid []]
    (if-let [f (first remaining)]
      (if (corrupt-handoff? (slurp (str f)))
        (do (quarantine-corrupt-handoff! f)
            (recur (next remaining) (conj corrupt f) valid))
        (recur (next remaining) corrupt (conj valid f)))
      {:corrupt corrupt :valid valid})))

(defn resolve-dequeueable-candidates
  "Shared by ready_for_next_task.bb and ready_for_next_batch.bb: dedups
   new-dir candidates against the completed/abandoned terminal set, then
   quarantines any corrupt candidate among what's left (BL-365), printing
   the SKIPPED/QUARANTINED diagnostic for each as a side effect. Returns
   the final list of files genuinely eligible to dequeue - both receive
   modes apply the identical corruption guard this way, rather than each
   re-deriving it."
  [new-files completed-basenames abandoned-basenames]
  (let [{:keys [skipped dequeueable]} (dedup-new-candidates new-files completed-basenames abandoned-basenames)
        {:keys [corrupt valid]} (partition-corrupt dequeueable)]
    (doseq [f skipped]
      (println "SKIPPED already-processed:" (fs/file-name f)))
    (doseq [f corrupt]
      (println "QUARANTINED corrupt-handoff:" (fs/file-name f)))
    valid))

(defn print-task [file]
  (let [task-name (header-field file "task")
        typ (header-value file "type" "unknown")]
    (println "TASK:" (str file))
    (println "FROM:" (header-value file "from" "unknown"))
    (println "TYPE:" typ)
    (println "PRIORITY:" (header-value file "priority" "50"))
    (when task-name
      (println "TASK_NAME:" task-name))
    (println "PAYLOAD:")
    (print (body file))
    (println)
    (println "ACTION: This parcel is already in_process. Do NOT run ready_for_next.sh again until you finish it.")
    (when (= "git_handoff" typ)
      (println "1) Execute the PAYLOAD (merge_and_process …) in this worktree.")
      (when task-name
        (println (str "2) Implement " task-name " from backlog/active/ with your edit/test tools.")))
      (println "3) Commit, git_handoff to the next role, then done_with_current / ready_for_next.")
      (println "USE YOUR TOOLS NOW. Narrating or re-printing this TASK is not progress."))))
