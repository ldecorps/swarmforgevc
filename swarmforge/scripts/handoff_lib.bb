;; Shared helpers for the inbox-facing handoff scripts (ready_for_next_task.bb,
;; done_with_current_task.bb, ready_for_next_batch.bb, done_with_current_batch.bb).
;; Loaded via load-file, not required on a classpath, so callers do:
;;   (load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
;; and refer to symbols as handoff-lib/foo.

(ns handoff-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

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
(def sidecar-suffixes [".nudge" ".chase.json"])

(defn sidecar-file? [path]
  (let [filename (fs/file-name path)]
    (boolean (some #(str/ends-with? filename %) sidecar-suffixes))))

(defn remove-sidecars-of!
  "Deletes <handoff-file>.nudge and <handoff-file>.chase.json if present -
   called right after a handoff moves to completed/, so its now-orphaned
   sidecars never linger in in_process/ to wedge later stuck-parcel checks."
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

(defn dedup-new-candidates
  "Splits new-dir candidate file paths (already sorted; mine? already
   applied by the caller for task mode) into :skipped (basename already
   terminal - must not be resurrected) and :dequeueable (genuinely new),
   preserving order. Builds the terminal-basename set once up front rather
   than calling already-terminal? (which re-builds both sets from scratch)
   per candidate - O(n+m) instead of O(n*m) for n candidates and m
   completed/abandoned basenames."
  [new-files completed-basenames abandoned-basenames]
  (let [terminal-basenames (into (set completed-basenames) abandoned-basenames)
        terminal? (fn [f] (contains? terminal-basenames (fs/file-name f)))]
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

(defn tmux-socket []
  (str/trim (slurp (str (fs/path (target-root) ".swarmforge" "tmux-socket")))))

(defn launch-script-path [role-name]
  (str (fs/path (target-root) ".swarmforge" "launch" (str role-name ".sh"))))

(defn pane-id [socket]
  (let [result (sh/sh "tmux" "-S" socket "display-message" "-p" "#{pane_id}")]
    (str/trim (:out result))))

(defn respawn-self!
  "Respawns this role's own tmux pane at the idle boundary (BL-089), running
   the same launch script a fresh pane launch would run so the new session
   gets the full role re-bootstrap. Mirrors the coordinator's manual
   respawn-pane procedure, but self-triggered from inside the pane being
   replaced instead of from an operator pane."
  [role-name]
  (let [socket (tmux-socket)
        pane (pane-id socket)
        script (launch-script-path role-name)]
    (sh/sh "tmux" "-S" socket "respawn-pane" "-k" "-t" pane (str "zsh '" script "'"))))

(defn print-task [file]
  (let [task-name (header-field file "task")]
    (println "TASK:" (str file))
    (println "FROM:" (header-value file "from" "unknown"))
    (println "TYPE:" (header-value file "type" "unknown"))
    (println "PRIORITY:" (header-value file "priority" "50"))
    (when task-name
      (println "TASK_NAME:" task-name))
    (println "PAYLOAD:")
    (print (body file))))
