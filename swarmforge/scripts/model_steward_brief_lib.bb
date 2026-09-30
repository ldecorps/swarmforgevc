;; BL-1815: the knowledge brief a Claude seat writes for a local-model
;; successor at a trial boundary - decision, request text and disk-poll
;; wait, kept separate from model_steward_cli.bb so a test can load-file
;; this alone (the CLI's own top-level form dispatches and exits on load).
(ns model-steward-brief-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "handoff_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_inject.bb")))

;; FIRM (ticket approval_context): the brief budget is 2000 characters.
(def brief-char-limit 2000)

(def default-wait-s 60)
(def default-poll-ms 250)

(defn brief-owed?
  "A brief is owed exactly when the outgoing seat runs the claude agent and
   the incoming seat runs the local-model agent (FIRM: every other pair,
   aider included, behaves exactly as today)."
  [outgoing-agent incoming-agent]
  (and (= outgoing-agent "claude") (= incoming-agent "local-model")))

(defn classify-brief
  "raw is the brief file's slurped content, or nil when it never appeared
   within the wait. Never throws; always one of :ok true/:brief, or
   :ok false/:reason naming exactly \"no brief\", \"empty brief\" or
   \"over 2000\" (the three refusal reasons the ticket names)."
  [raw]
  (cond
    (nil? raw) {:ok false :reason "no brief"}
    (str/blank? (str/trim raw)) {:ok false :reason "empty brief"}
    (> (count (str/trim raw)) brief-char-limit) {:ok false :reason "over 2000"}
    :else {:ok true :brief (str/trim raw)}))

(defn brief-dir [target-root role]
  (str (fs/path target-root ".swarmforge" "agent-memory" role)))

(defn brief-path [target-root role]
  (str (fs/path (brief-dir target-root role) "brief.md")))

(defn brief-request-text
  "The whole instruction, so no role prompt needs a new convention (ticket
   direction) - what to cover, the exact path, and the character limit."
  [role wait-s path]
  (str "Before your role hands off to a local model, write a short knowledge "
       "brief for your successor at " path " (create the directory first if "
       "it does not exist). Cover: the open parcels for the " role
       " role and their state, decisions already taken, landmines to avoid, "
       "and what to do next or never redo. Keep it to at most " brief-char-limit
       " characters of plain prose - no filler, no markdown fences. You have "
       "about " wait-s " seconds."))

(defn- read-tmux-socket [target-root]
  (let [file (fs/path target-root ".swarmforge" "tmux-socket")]
    (when (fs/exists? file)
      (not-empty (str/trim (slurp (str file)))))))

(defn resolve-pane-target
  "{:socket :session :agent} for role's live pane, or nil when there is
   nothing to inject into - no tmux socket file (a fixture with no tmux at
   all), no roles.tsv row, or no resolvable session. The caller then simply
   skips injection and still waits for the file; a stub-pane fixture never
   needs a real tmux session to exercise the wait/refuse behaviour."
  [target-root role]
  (when-let [socket (read-tmux-socket target-root)]
    (when-let [role-info (handoff-lib/load-role-info role target-root)]
      (let [session (handoff-lib/wake-session socket (:session role-info))]
        (when-not (str/blank? session)
          {:socket socket :session session :agent (or (:agent role-info) "claude")})))))

(defn- env-long [name default]
  (or (some-> (System/getenv name) (Long/parseLong)) default))

;; QA bounce D1 (BL-1815, 2026-09-30): a brief.md already sitting at
;; brief-path when request-brief! starts - left by an earlier boundary, or
;; simply stale - was accepted immediately, with no request and no wait.
;; "Owed" means the OUTGOING seat's fresh brief, written IN RESPONSE TO
;; THIS request; a pre-existing file can never be that, whatever it
;; contains. Clearing it before injecting is what makes the poll loop
;; below observe only content written after this call began. Best-effort:
;; a delete that fails (permissions, already gone) is not fatal - the
;; poll loop still only trusts a write it can prove happened after the
;; clear, per the mtime-vs-cleared-at check there.
(defn- clear-existing-brief! [path]
  (try (fs/delete-if-exists path) (catch Exception _ nil)))

;; QA bounce D2 (BL-1815, 2026-09-30), extracted as its own pure predicate
;; so the stability rule itself - not just its end-to-end timing effect -
;; can be pinned with no sleep, no subprocess, no timing tolerance: a file
;; is trusted only once its content reads back IDENTICAL on two
;; consecutive polls. `nil` never counts as stable (absence must keep
;; polling to the deadline, never "stabilize" on two nil reads - the "no
;; brief" timing contract test 01 relies on this).
(defn stable-read? [last-content current]
  (and (some? current) (= last-content current)))

(defn request-brief!
  "Injects the request into the outgoing seat's live pane when one resolves
   (BL-1719-guarded through agent-runtime-inject/notify-agent!; a fixture
   with no tmux socket simply gets no injection attempt), then polls
   brief-path for up to wait-s seconds. Returns classify-brief's verdict.
   Never throws - an injection failure still leaves the wait/classify path
   to decide the outcome from disk.

   QA bounce fixes (BL-1815, 2026-09-30):
   D1 - any brief.md already at brief-path is cleared BEFORE the request is
   injected, so only a write that happens after this call began can ever be
   observed - a leftover from an earlier boundary is never accepted.
   D2 - a file is trusted only once its content reads back IDENTICAL on two
   consecutive polls (poll-ms apart): the outgoing seat's write is still in
   flight the instant it first appears, so the very first sighting is never
   classified on its own."
  [target-root role]
  (let [wait-s (env-long "MODEL_STEWARD_BRIEF_WAIT_S" default-wait-s)
        poll-ms (env-long "MODEL_STEWARD_BRIEF_POLL_MS" default-poll-ms)
        path (brief-path target-root role)
        text (brief-request-text role wait-s path)]
    (clear-existing-brief! path)
    (when-let [{:keys [socket session agent]} (resolve-pane-target target-root role)]
      (try
        (agent-runtime-inject/notify-agent! socket session agent :text text :raw? true)
        (catch Exception _ nil)))
    (let [deadline-ms (+ (System/currentTimeMillis) (* wait-s 1000))]
      (loop [last-content nil]
        (let [current (when (fs/exists? path)
                        (try (slurp (str path)) (catch Exception _ nil)))
              stable? (stable-read? last-content current)]
          (cond
            stable? (classify-brief current)
            (>= (System/currentTimeMillis) deadline-ms) (classify-brief current)
            :else (do (Thread/sleep (long poll-ms)) (recur current))))))))
