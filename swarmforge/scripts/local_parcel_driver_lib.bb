#!/usr/bin/env bb
;; BL-1697: the local parcel driver - moves a coder git_handoff parcel
;; through a local aider seat deterministically. Lives inside handoffd's
;; own loop (never a separate process): handoffd already owns every pane
;; injection from one place, so a driver anywhere else would race the
;; wake/chase/resume injections it must instead suppress for the seat it
;; currently owns (invariant 2).
;;
;; A 7B model cannot hold this procedure itself (overnight lab,
;; backlog/evidence/aider-seat-lab-20260924.md): the driver holds every
;; step, types exactly one instruction per turn, and gates the RESULT
;; (git state), never the model's own narration - `--llm-history-file` is
;; where a human reads what the model said; this file never scrapes the
;; pane for it.
;;
;; Loaded via load-file, referred to as local-parcel-driver-lib/foo.
(ns local-parcel-driver-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str])
  (:import [java.io File]))

(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path lib-dir "agent_runtime_inject.bb")))
(load-file (str (fs/path lib-dir "required_stages_lib.bb")))

;; ── Pure: seat identification ────────────────────────────────────────────

(def driving-roles
  "Roles this slice's driver drives. Out of scope per the ticket's own
   text: any other role on a driver-capable seat is left exactly as
   today, wakes included (the BL-1702 ruling). Widening this is a data
   change here, never a new branch at a call site."
  #{"coder"})

(defn- base-role
  "roles.tsv keys a stage's second seat as \"coder@2\" (BL-1702's mixed
   pack: a local coder beside the Claude coder) - the SEAT id, never a
   second role. Stripped before checking driving-roles so a driver seat
   is recognized regardless of which numbered seat it is."
  [role]
  (first (str/split (or role "") #"@")))

(defn driver-seat?
  "True when `agent`'s provider carries the parcel-driver capability AND
   `role`'s own stage (role, stripped of a \"@N\" seat suffix) is one the
   driver drives. Capability, not provider name (capability-branching-01)
   - a raw \"aider\" string check anywhere else in this file or in
   handoffd.bb is out of policy."
  [agent role]
  (boolean (and (prompt-engine-lib/parcel-driver-capable? agent)
                (contains? driving-roles (base-role role)))))

;; ── Impure: sibling-seat identity (BL-1715, the give-up branch) ─────────
;; Reads roles.tsv directly - identity/agent, never mailbox state, so this
;; has no dependency on handoff_lib.bb (BL-983's own layering).

(defn- roles-tsv-rows [project-root]
  (let [p (fs/path project-root ".swarmforge" "roles.tsv")]
    (if (fs/exists? p)
      (->> (str/split-lines (slurp (str p)))
           (remove str/blank?)
           (map #(str/split % #"\t")))
      [])))

(defn has-non-driver-sibling?
  "True when role's stage (base-role stripped) has at least one OTHER
   roles.tsv row of the same stage whose agent is not driver-capable
   (BL-1715 requirement 1: give up rather than escalate-and-hold only when
   such a sibling exists to work the parcel next)."
  [project-root role]
  (let [stage (base-role role)]
    (boolean
     (some (fn [row]
             (let [row-role (nth row 0 nil)
                   row-agent (nth row 5 nil)]
               (and (not= row-role role)
                    (= stage (base-role row-role))
                    (not (driver-seat? row-agent row-role)))))
           (roles-tsv-rows project-root)))))

;; ── Pure: the red-check decision (step 3, before any model turn) ────────

(defn red-check-decision
  "acceptance-passed? is the ticket's own acceptance run's result BEFORE
   any model edit. A pass here means there is nothing for the model to
   fix - escalated immediately, never handed an instruction (invariant
   1's first condition, the only one checked before the model ever gets
   a turn)."
  [acceptance-passed?]
  (if acceptance-passed?
    {:pass false :reason "acceptance passed before any edit"}
    {:pass true}))

;; ── Pure: the green gate decision (step 6, after the model's turn) ──────

(defn green-gate-decision
  "Invariant 1's remaining four conditions. has-commit? is checked BEFORE
   acceptance-passes? on purpose (BL-1697 scenario 02's own table): a
   turn with no commit at all also naturally fails acceptance (nothing
   changed), and reporting \"acceptance still failing\" there would be
   true but misleading - it reads as \"the model tried and failed\" when
   it did not try at all. The remaining two stay after acceptance: the
   spec's own bytes prove the model never edited what it was told not
   to, and the editable-set check catches an aider auto-add outside the
   files it was given (lab S1 watched a 7B model rewrite a pipeline
   script reached only because a reply named its path)."
  [{:keys [acceptance-passes? has-commit? spec-bytes-identical? touched-paths editable-set]}]
  (cond
    (not has-commit?) {:pass false :reason "no model commit"}
    (not acceptance-passes?) {:pass false :reason "acceptance still failing"}
    (not spec-bytes-identical?) {:pass false :reason "spec changed"}
    (not (every? editable-set touched-paths)) {:pass false :reason "edited outside its files"}
    :else {:pass true}))

;; ── Pure: ticket text parsing (the same shape every *_lib.bb in this
;; tree keeps its own private copy of - BL-1697 is not the file that
;; consolidates it) ───────────────────────────────────────────────────────

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- strip-quotes [s]
  (str/replace (or s "") #"^[\"']|[\"']$" ""))

(defn ticket-id [content]
  (read-yaml-field content "id"))

(defn ticket-acceptance-path [content]
  (strip-quotes (read-yaml-field content "acceptance")))

;; A path this ticket "names": every backtick-quoted path-shaped token
;; under its own "## Scope" section (the one place every ticket in this
;; tree already lists exactly the files it touches, in the author's own
;; words - not a free-text scan of the whole description, which would
;; also catch a path merely mentioned as an example or a citation), plus
;; every required_wiring entry's own file (the part before its first
;; "::"). "Path-shaped": contains a "/" or a "." - excludes a bare English
;; word a Scope bullet's prose might backtick for emphasis.
(defn- backtick-tokens [text]
  (->> (re-seq #"`([^`]+)`" text)
       (map second)))

(defn- path-shaped? [s]
  (boolean (and s (or (str/includes? s "/") (re-find #"\.[A-Za-z0-9]+$" s)))))

(defn- scope-section-text
  "Every ticket in this tree's own convention ends its Scope section with
   an \"Out of scope: ...\" bullet naming paths that must NOT be editable
   (BL-1712's own pricing rows citation is one example) - collection stops
   there, never at the next \"## \" header alone, or a path named only to
   say it is excluded would be handed to the model as editable."
  [content]
  (let [lines (str/split-lines content)
        start (->> lines (map-indexed vector) (some (fn [[i l]] (when (str/starts-with? (str/trim l) "## Scope") i))))]
    (if-not start
      ""
      (->> (drop (inc start) lines)
           (take-while (fn [l] (not (str/starts-with? (str/trim l) "## "))))
           (take-while (fn [l] (not (re-find #"(?i)out of scope" l))))
           (str/join "\n")))))

(defn- required-wiring-file-paths [content]
  (let [lines (str/split-lines content)
        start (->> lines (map-indexed vector) (some (fn [[i l]] (when (= "required_wiring:" (str/trim l)) i))))]
    (if-not start
      []
      (->> (drop (inc start) lines)
           (take-while (fn [l] (str/starts-with? (str/trim l) "-")))
           (map (fn [l] (-> l str/trim (subs 1) str/trim strip-quotes)))
           (map (fn [entry] (first (str/split entry #"::"))))
           (remove str/blank?)))))

(defn editable-paths
  "The ticket's own named files - repo-relative, deduplicated, sorted for
   a deterministic chat-set order. A path this returns that does not yet
   exist in the checkout is still returned (the ticket direction: `/add`
   creates it); existence filtering, if any, is the caller's own concern
   for what to /read-only versus /add, never this function's."
  [ticket-content]
  (->> (concat (->> (scope-section-text ticket-content) backtick-tokens (filter path-shaped?))
               (required-wiring-file-paths ticket-content))
       distinct
       sort
       vec))

;; A path the driver must never /add regardless of what a ticket or a
;; model reply names (FIRM: no pipeline script in a seat's chat).
(def forbidden-chat-prefixes
  ["swarmforge/scripts/" "swarmforge/roles/" "swarmforge/constitution/"])

(defn forbidden-chat-path? [path]
  (boolean (some #(str/starts-with? path %) forbidden-chat-prefixes)))

;; ── Pure: pane idle detection ────────────────────────────────────────────
;; aider's own auto-test loop (BL-1699) can run several rounds before
;; returning to its prompt - the turn ends there, never at the first
;; reply, so this checks for an EMPTY prompt line (ready for new input),
;; not merely "some line ending in a prompt character with stray
;; leftover text" (agent-runtime-inject/pending-input-line's own job,
;; answering a different question: is there UNSUBMITTED text sitting at
;; the prompt).
(defn turn-idle? [pane-text]
  (let [line (agent-runtime-inject/last-non-blank-line pane-text)]
    (boolean (and line (re-find #"[$#❯>]\s*$" line)))))

;; ── Impure: state file (keyed by seat id, never role - BL-1702's mixed
;; pack can run a driver seat as a stage's SECOND seat, e.g. coder@2) ────

(defn state-dir [project-root]
  (str (fs/path project-root ".swarmforge" "local-driver")))

(defn state-path [project-root seat-id]
  (str (fs/path (state-dir project-root) (str seat-id ".json"))))

(defn- keyword->original-string
  "cheshire's (keyword s) on a path with a \"/\" splits it into a
   namespace/name pair (Clojure's own 1-arg keyword function does this,
   not just the reader) - for an ABSOLUTE path (\"/a/b.yaml\") the
   namespace is the empty string and (name k) alone silently drops the
   leading slash. (subs (str k) 1) instead reads back the keyword's own
   printed form (\":\" + namespace + \"/\" + name, or just \":\" + name
   with no namespace) and strips only the leading \":\" - the exact
   inverse of (keyword s) for every s this file ever passes it, checked
   for a leading-slash absolute path, an interior-slash relative path,
   and a slash-free bare filename."
  [k]
  (subs (str k) 1))

(defn read-driver-state
  "keywordize-keys (true, below) recurses into EVERY nested JSON object,
   not just the top level - specHashesBefore's own keys are file paths,
   so a round trip through this reader turns them into keywords, never =
   to the plain string keys green-gate-decision's own freshly-computed
   hash map uses for the same paths. Restored via
   keyword->original-string, never (name k) alone."
  [project-root seat-id]
  (let [p (state-path project-root seat-id)]
    (when (fs/exists? p)
      (let [raw (json/parse-string (slurp p) true)]
        (cond-> raw
          (:specHashesBefore raw)
          (update :specHashesBefore (fn [m] (into {} (map (fn [[k v]] [(keyword->original-string k) v]) m)))))))))

(defn write-driver-state! [project-root seat-id state]
  (let [p (state-path project-root seat-id)]
    (fs/create-dirs (fs/parent p))
    (spit p (json/generate-string state))))

(defn clear-driver-state! [project-root seat-id]
  (let [p (state-path project-root seat-id)]
    (when (fs/exists? p) (fs/delete p))))

;; ── BL-1715 requirement 4: the local seat's own scorecard ───────────────

(defn outcomes-path [project-root]
  (str (fs/path (state-dir project-root) "outcomes.jsonl")))

(defn record-outcome!
  "Appends one JSON line - seat id, model, ticket, outcome
   (handed-off|given-up|escalated), failed condition (nil on handed-off),
   fix turns used, wall time. Append-only: one row per parcel the driver
   ends. The BL-1702 runbook reads this as the local seat's scorecard
   under live swarm control."
  [project-root {:keys [seat-id model ticket outcome reason fix-turns-used wall-ms]}]
  (let [p (outcomes-path project-root)]
    (fs/create-dirs (fs/parent p))
    (spit p
          (str (json/generate-string
                {:seatId seat-id :model model :ticket ticket :outcome outcome
                 :reason reason :fixTurnsUsed fix-turns-used :wallMs wall-ms
                 :at (str (java.time.Instant/now))})
               "\n")
          :append true)))

(defn- driver-wall-ms [started-at-ms]
  (when started-at-ms (- (System/currentTimeMillis) started-at-ms)))

;; ── Impure: the seat CLI (BL-1696) - the driver's only channel into the
;; seat's own checkout; never a pipeline script run directly ─────────────

(defn seat!
  "Runs `seat <args...>` in checkout with SWARMFORGE_ROLE set (BL-1696).
   extra-env, when given, is merged on top - e.g. SEAT_TICKET/
   SEAT_ACCEPTANCE for the test verb. args is a vector, never varargs, so
   an extra-env map can never be mistaken for a trailing CLI argument.
   sh!'s own opts-first calling convention (split-sh-args:
   (map? (first args)) means opts is FIRST, not trailing) - an opts map
   passed last is silently absorbed into the command vector instead
   (stringified) and :dir/:extra-env are never applied, so the child runs
   with THIS PROCESS's own cwd/env - the exact shape that ran `seat` for
   real against the live coder worktree during this ticket's own
   development (caught before any parcel state changed, since the
   fixture's own commit shas do not exist there - see evidence)."
  [checkout role args & [extra-env]]
  (apply daemon-cycle-guard-lib/sh!
         {:dir checkout :extra-env (merge {"SWARMFORGE_ROLE" role} extra-env)}
         (str (fs/path checkout "swarmforge" "scripts" "seat"))
         args))

(defn seat-test! [checkout role ticket acceptance-path]
  (seat! checkout role ["test"] {"SEAT_TICKET" ticket "SEAT_ACCEPTANCE" acceptance-path}))

(defn driver-test-scope
  "BL-1699 requirement 4: what `seat test` should scope to when aider's OWN
   --auto-test loop calls it directly - never through seat-test! above, so
   SEAT_TICKET/SEAT_ACCEPTANCE are never set in that caller's environment.
   Reads this seat's own BL-1697 driver record (the same one resume/hold
   read) for :ticket/:acceptancePath. nil when there is no record, or the
   record names no ticket yet (pre-merge/mechanical-mail phases) - the
   caller then runs unscoped, exactly BL-1696's original behaviour."
  [project-root seat-id]
  (let [{:keys [ticket acceptancePath]} (read-driver-state project-root seat-id)]
    (when (and ticket acceptancePath)
      {:ticket ticket :acceptancePath acceptancePath})))

;; ── Impure: read-only file protection - advisory `/read-only` in the
;; chat is auto-accepted under --yes-always (BL-1696/BL-1697's own "What
;; is wrong"), so the real protection is the filesystem permission; both
;; are applied, never one alone. The two-arg File/setWritable
;; (owner-only? false) strips/restores the write bit for owner, group AND
;; other - the single-arg form only ever touches the OWNER's bit, which a
;; permissive umask (group-writable create mode) leaves genuinely
;; writable by the same group the seat process runs as - not
;; \"physically unwritable\" at all (FIRM in the ticket's own
;; approval_context)."
(defn set-writable! [path writable?]
  (.setWritable (File. (str path)) (boolean writable?) false))

(defn file-sha256 [path]
  (prompt-engine-lib/sha256-hex (slurp (str path))))

;; ── Impure: typing into the seat's pane - agent-runtime-inject's own
;; capture/submit/retry machinery, never a hand-rolled second path. `:raw?
;; true` (BL-1697's addition to notify-agent!) is what keeps every driver
;; message free of the aider-no-narration-suffix (invariant: the chat set
;; and every instruction/fix-request are the driver's own words only).
(defn type-raw! [socket session agent text]
  (agent-runtime-inject/notify-agent! socket session agent :text text :raw? true))

(defn chat-clear! [socket session agent]
  (type-raw! socket session agent "/clear"))

(defn chat-read-only! [socket session agent path]
  (type-raw! socket session agent (str "/read-only " path)))

(defn chat-add! [socket session agent path]
  (type-raw! socket session agent (str "/add " path)))

;; BL-1698 D3 (QA bounce 2026-09-25), refined by pass 2 (D1/D2, same day):
;; a relaunched aider chat has no memory of a pre-crash /clear, /read-only
;; or /add - a fix request typed straight into it (run-gate!'s normal
;; path, or resume-from-hold!'s answer-driven one) would land with no
;; spec context and, worse, into a spec file the running process never
;; marked unwritable. `chat-set-up!` is continue-after-merge!'s own
;; sequence, factored out so every fix-request path redoes it.
;;
;; Pass 1 gated this on a "done once per daemon process" marker; pass 2
;; found two live gaps a process-lifetime marker cannot see - the same
;; process's own hold-release fix request (D1, fixed by resume-from-hold!
;; calling this unconditionally) and a seat relaunched mid-parcel without
;; a daemon restart (D2 - a fresh aider process in the same pane, which a
;; process-lifetime marker never notices). QA's own remediation pointer
;; sanctions the direct fix for both: redo the set-up before every fix
;; request, full stop - no marker, no pane-identity probe to keep in
;; sync with reality. The per-turn cost is one /clear + a few /read-only
;; and /add lines; correctness after either failure mode is worth it.
(defn- chat-set-up! [ctx state]
  (let [{:keys [checkout agent socket session]} ctx
        {:keys [specFiles editablePaths]} state]
    (chat-clear! socket session agent)
    (doseq [p specFiles] (chat-read-only! socket session agent p))
    (doseq [p editablePaths] (chat-add! socket session agent (str (fs/path checkout p))))
    (doseq [p specFiles] (set-writable! p false))))

(def instruction-text-template
  "implement %s exactly as the read-only ticket describes so the read-only acceptance passes; never edit a read-only file.")

(defn instruction-text [ticket]
  (format instruction-text-template ticket))

(defn fix-request-text [ticket reason]
  (format "%s did not pass the gate (%s) - fix it; never edit a read-only file." ticket reason))

;; ── Impure: git state after the merge ─────────────────────────────────

(defn git! [checkout & args]
  (apply daemon-cycle-guard-lib/sh! "git" (concat ["-C" checkout] args)))

(defn head-sha [checkout]
  (str/trim (:out (git! checkout "rev-parse" "HEAD"))))

(defn commit-count-since [checkout since-sha]
  (let [out (str/trim (:out (git! checkout "rev-list" (str since-sha "..HEAD") "--count")))]
    (try (Integer/parseInt out) (catch Exception _ 0))))

(defn touched-paths-since [checkout since-sha]
  (->> (str/split-lines (:out (git! checkout "diff" "--name-only" (str since-sha "..HEAD"))))
       (remove str/blank?)
       vec))

;; ── The default fix-turn limit, overridable per pack (config
;; seat_fix_turns) - the caller (handoffd, or a test) resolves the pack
;; config value and passes it in; this file never reads a conf file
;; itself.
(def default-fix-turns 3)

;; ── The orchestration: one tick, advancing exactly as far as it safely
;; can without blocking (handoffd's own poll cadence calls this once per
;; cycle; a test drives it in a tight loop against a fake pane that
;; answers immediately - same function, same contract, either way).
;;
;; ctx keys: :project-root :checkout :role :seat-id :agent :socket
;;           :session :fix-turns-limit
;; Every impure boundary above is called directly (never re-injected via
;; ctx) except the two the acceptance harness must intercept without a
;; real tmux server or a real seat/git tree: pane capture and seat!/git!
;; go through the REAL functions, which is exactly why the acceptance
;; tests fake `tmux` and stage a real throwaway git checkout instead of
;; stubbing this file's own functions - the contract under test is what
;; those real subprocesses are actually told, not a mock of this
;; function's own internals.
(defn escalate! [ctx ticket reason]
  (let [{:keys [checkout role]} ctx]
    (seat! checkout role ["ask" (format "%s: %s" ticket reason)])))

(defn restore-spec-writable! [state]
  (doseq [p (:specFiles state)]
    (set-writable! p true)))

;; ── BL-1698 requirement 1: boot-time write-permission sweep ─────────────
;; A crash between `set-writable! p false` and the driver's own terminal
;; path (which always restores it) leaves a spec file physically
;; unwritable with no live record left to restore it via the normal
;; terminal path - the ONLY safety net is a sweep that scans every
;; persisted record, not just the one this tick happens to be driving.

(defn resume-writable-sweep!
  "For every driver record under state-dir (every seat, every role),
   restores write permission on every spec file the record names.
   Idempotent - an already-writable file is untouched. Must run once,
   before this process's first drive-tick! - never per-tick, which would
   defeat the \"unwritable while the model works\" protection itself."
  [project-root]
  (let [dir (state-dir project-root)]
    (when (fs/exists? dir)
      (doseq [f (fs/list-dir dir)]
        (when (str/ends-with? (str f) ".json")
          (let [seat-id (str/replace (fs/file-name f) #"\.json$" "")
                state (read-driver-state project-root seat-id)]
            (restore-spec-writable! state)))))))

;; ── BL-1698 requirement 4: mail that needs no model turn ────────────────

(def ^:private qa-merge-up-pattern
  #"QA-approved ([0-9a-f]{10}) - merge your branch up to QA's")

(defn qa-merge-up-note?
  "True when a `type: note` message matches handoff-protocol.md's own QA
   merge-up shape (Article 2.5's example: \"BL-042 QA-approved
   a1b2c3d4e5 - merge your branch up to QA's\"). The exact shape only,
   never sender alone - a note FROM QA that is not this shape still
   takes requirement 5's ask path."
  [message]
  (boolean (re-find qa-merge-up-pattern (or message ""))))

(defn merge-up-commit [message]
  (second (re-find qa-merge-up-pattern (or message ""))))

(defn mechanical-mail!
  "Requirement 4: merge the named commit with no model turn, then
   complete with no git_handoff and no text typed into the pane. A merge
   conflict escalates like a ticket parcel's own merge-conflict path
   (BL-1697), using \"mail\" as the pseudo-ticket id since this mail
   carries no ticket of its own - the question is raised AND a driver
   record is persisted naming why, same as start-ticket-parcel!'s own
   conflict branch, so the mail never sits in_process with no record
   (invariant 2) and an operator can release it via release-hold! the
   same way any other hold is released."
  [ctx sender commit]
  (let [{:keys [project-root checkout role seat-id]} ctx
        merge-result (seat! checkout role ["merge" sender commit])]
    (if (zero? (:exit merge-result))
      (seat! checkout role ["done"])
      (do (escalate! ctx "mail" "merge conflict")
          (write-driver-state! project-root seat-id {:escalated true :ticket "mail" :reason "merge conflict"})))))

;; ── BL-1698 requirement 5: any other note ────────────────────────────────

(defn- truncate-80 [s]
  (let [s (str s)]
    (if (> (count s) 80) (subs s 0 80) s)))

(defn ask-or-escalate-to-coordinator!
  "Raises one question for the driver's own role (`seat ask`, which execs
   role_ask.bb and passes its stdout straight through); when that role's
   ask slot is already taken (role_ask.bb -> {:asked false :reason
   \"already-pending\"}), sends the SAME text to the coordinator instead
   as a priority-00 note (`seat note`, its own 80-char bound) - the mail
   never wedges the seat either way. Returns which path was used."
  [ctx question]
  (let [{:keys [checkout role]} ctx
        ask-result (seat! checkout role ["ask" question])
        parsed (try (json/parse-string (str/trim (or (:out ask-result) "")) true)
                    (catch Exception _ nil))]
    (if (and parsed (false? (:asked parsed)) (= "already-pending" (:reason parsed)))
      (do (seat! checkout role ["note" "coordinator" "00" (truncate-80 question)])
          :coordinator-note)
      :role-ask)))

;; ── BL-1698 requirement 2: hold release by the human's answer ───────────

(defn answer-available?
  "The ONLY sanctioned entry point for a waiting answer (BL-1244):
   `deliver-role-answer.js --role <role>`, never a direct read of
   role-answers/<role>.json. Returns the answer text, or nil when there
   is nothing to act on yet (no-answer/already-consumed/mismatch all
   read the same to this caller)."
  [checkout role]
  (let [deliver-js (str (fs/path checkout "extension" "out" "tools" "deliver-role-answer.js"))]
    (when (fs/exists? deliver-js)
      (let [result (daemon-cycle-guard-lib/sh! {:dir checkout} "node" deliver-js "--role" role)]
        (when (zero? (:exit result))
          (let [parsed (try (json/parse-string (:out result) true) (catch Exception _ nil))]
            (when (= "delivered" (:kind parsed))
              (:text parsed))))))))

(defn answer-fix-request-text [ticket answer-text]
  (format "%s: %s - fix it; never edit a read-only file." ticket answer-text))

(defn resume-from-hold!
  "When a waiting answer is available for an escalated hold that carries
   gate context (:acceptancePath - a real ticket parcel past its merge),
   consumes it, ALWAYS redoes the chat set-up first (pass 2 D1: escalation
   has just made the spec writable again, so the answer's fix request
   must never land in a chat that still thinks the spec is read-only from
   the prior fix turn), types ONE fix request carrying the answer text, and re-arms
   the gate at its OWN limit (fixTurnsUsed = fixTurnsLimit, not
   fixTurnsLimit - 1: the answer's fix request IS the one extra try, so
   the very next failed gate must escalate immediately rather than typing
   a second, generic fix request first - BL-1698 D4). A hold with no
   :acceptancePath (a mail merge-conflict hold - requirement 4 promises
   it no model turn) has no gate to re-arm and no ticket instruction to
   answer; its disposition is genuinely ambiguous (BL-1698 D5), so this
   is a no-op and the answer is left UNCONSUMED - an operator resolves it
   via `release` instead. A no-op either way when no answer is waiting -
   the hold stays parked, same as before this ticket."
  [ctx state]
  (let [{:keys [project-root seat-id agent socket session]} ctx]
    (when (:acceptancePath state)
      (when-let [answer-text (answer-available? (:checkout ctx) (:role ctx))]
        (let [ticket (:ticket state)
              fix-limit (or (:fixTurnsLimit state) default-fix-turns)]
          (chat-set-up! ctx state)
          (type-raw! socket session agent (answer-fix-request-text ticket answer-text))
          (write-driver-state!
           project-root seat-id
           (-> state
               (dissoc :escalated :reason)
               (assoc :phase "awaiting-model"
                      :fixTurnsLimit fix-limit
                      :fixTurnsUsed fix-limit))))))))

;; ── BL-1698 requirement 3: hold release by the operator ──────────────────

(defn release-hold!
  "A driver CLI verb, never typing into the pane. \"complete\" completes
   the parcel with no git_handoff (so the ticket can be rerouted) and
   clears the record; \"retry\" clears the record so the next pass
   serves the parcel afresh. Restores spec write permission either way,
   same invariant as every other terminal path. Returns nil when there
   is no record for this seat (nothing to release)."
  [project-root checkout role seat-id mode]
  (let [state (read-driver-state project-root seat-id)]
    (when state
      (restore-spec-writable! state)
      (case mode
        "complete"
        (do (seat! checkout role ["done"])
            (clear-driver-state! project-root seat-id)
            {:result "completed"})
        "retry"
        (do (clear-driver-state! project-root seat-id)
            {:result "cleared"})
        (throw (ex-info (str "release-hold!: unknown mode " (pr-str mode)) {:mode mode}))))))

;; ── BL-1698 requirement 1: the resumable half of a ticket parcel ────────

(defn- persist-post-merge!
  [project-root seat-id ticket sender post-merge-head extra]
  (write-driver-state! project-root seat-id
                        (merge {:phase "post-merge" :ticket ticket :senderRole sender :postMergeHead post-merge-head}
                               extra)))

(defn continue-after-merge!
  "Red-check through typing the instruction - called fresh right after a
   merge, or on resume when state is already at phase \"post-merge\";
   either way the merge itself never runs again here (invariant: a
   parcel commit is merged exactly once). State is persisted to phase
   \"awaiting-model\" BEFORE the instruction is typed, so a crash after
   that point resumes straight into drive-tick!'s \"awaiting-model\"
   branch and never retypes it."
  [ctx state]
  (let [{:keys [project-root checkout role seat-id agent socket session fix-turns-limit]} ctx
        {:keys [ticket postMergeHead senderRole commit priority preClaimHead startedAtMs]} state
        ticket-yaml-path (str (fs/path checkout "backlog" "active" (str ticket ".yaml")))
        ticket-content (slurp ticket-yaml-path)
        acceptance-path (ticket-acceptance-path ticket-content)
        acceptance-full (str (fs/path checkout acceptance-path))
        red (seat-test! checkout role ticket acceptance-full)
        red-decision (red-check-decision (zero? (:exit red)))]
    (if-not (:pass red-decision)
      (do (escalate! ctx ticket (:reason red-decision))
          (write-driver-state! project-root seat-id {:escalated true :ticket ticket :reason (:reason red-decision)})
          (record-outcome! project-root {:seat-id seat-id :model agent :ticket ticket :outcome "escalated"
                                          :reason (:reason red-decision) :fix-turns-used 0
                                          :wall-ms (driver-wall-ms startedAtMs)}))
      (let [editable (->> (editable-paths ticket-content)
                           (remove forbidden-chat-path?)
                           vec)
            spec-files [ticket-yaml-path acceptance-full]
            spec-hashes (into {} (map (fn [p] [p (file-sha256 p)]) spec-files))]
        (chat-set-up! ctx {:specFiles spec-files :editablePaths editable})
        (write-driver-state!
         project-root seat-id
         {:phase "awaiting-model"
          :ticket ticket
          :senderRole senderRole
          :postMergeHead postMergeHead
          :commit commit
          :priority priority
          :preClaimHead preClaimHead
          :startedAtMs startedAtMs
          :specFiles spec-files
          :specHashesBefore spec-hashes
          :editablePaths editable
          :fixTurnsUsed 0
          :fixTurnsLimit (or fix-turns-limit default-fix-turns)
          :acceptancePath acceptance-full})
        (type-raw! socket session agent (instruction-text ticket))))))

(defn- start-ticket-parcel!
  [ctx sender commit ticket priority]
  (let [{:keys [project-root checkout role seat-id agent]} ctx
        ticket-yaml-path (str (fs/path checkout "backlog" "active" (str ticket ".yaml")))
        pre-claim-head (head-sha checkout)
        started-at-ms (System/currentTimeMillis)]
    (when-not (fs/exists? ticket-yaml-path)
      ;; Named by the parcel but not (yet) visible in this checkout - the
      ;; same "merge main first" condition every Claude role hits
      ;; (BL-1614); merge before reading it.
      (git! checkout "fetch" "origin" "main")
      (git! checkout "merge" "origin/main" "-m" (format "Merge main into %s.\n\nBy coder." role)))
    (let [merge-result (seat! checkout role ["merge" sender commit])]
      (if-not (zero? (:exit merge-result))
        (do (escalate! ctx ticket "merge conflict")
            (write-driver-state! project-root seat-id {:escalated true :ticket ticket :reason "merge conflict"})
            (record-outcome! project-root {:seat-id seat-id :model agent :ticket ticket :outcome "escalated"
                                            :reason "merge conflict" :fix-turns-used 0
                                            :wall-ms (driver-wall-ms started-at-ms)}))
        (let [post-merge-head (head-sha checkout)]
          ;; Persisted immediately - a crash between here and the chat
          ;; set-up resumes at phase "post-merge" and skips the merge.
          (persist-post-merge! project-root seat-id ticket sender post-merge-head
                                {:commit commit :priority priority
                                 :preClaimHead pre-claim-head :startedAtMs started-at-ms})
          (continue-after-merge! ctx (read-driver-state project-root seat-id)))))))

(defn start-new-parcel!
  "Step 1-5, generalized to every mail shape (BL-1698): a ticket
   git_handoff (unchanged behaviour, now split so the merge is
   resumable - requirement 1), a QA merge-up note or a non-forwarding
   reverse copy (requirement 4, no model turn), or any other note
   (requirement 5). Returns nil when there is nothing to serve this
   tick."
  [ctx]
  (let [{:keys [checkout role]} ctx
        served (seat! checkout role ["next"])]
    (when (zero? (:exit served))
      (let [in-process-dir (fs/path checkout ".swarmforge" "handoffs" "inbox" "in_process")
            parcel-file (some->> (when (fs/exists? in-process-dir) (fs/list-dir in-process-dir))
                                  (filter #(str/ends-with? (str %) ".handoff"))
                                  first)]
        (when parcel-file
          (let [parcel-text (slurp (str parcel-file))
                mail-type (read-yaml-field parcel-text "type")
                sender (read-yaml-field parcel-text "from")
                commit (read-yaml-field parcel-text "commit")
                ticket (read-yaml-field parcel-text "task")
                priority (read-yaml-field parcel-text "priority")
                message (read-yaml-field parcel-text "message")
                non-forwarding? (= "true" (read-yaml-field parcel-text "non-forwarding"))]
            (cond
              (and (= mail-type "note") (qa-merge-up-note? message))
              (mechanical-mail! ctx sender (merge-up-commit message))

              (and (= mail-type "git_handoff") non-forwarding?)
              (mechanical-mail! ctx sender commit)

              (= mail-type "note")
              (do (ask-or-escalate-to-coordinator! ctx (format "%s: %s" sender message))
                  (seat! checkout role ["done"]))

              :else
              (start-ticket-parcel! ctx sender commit ticket priority))))))))

;; ── BL-1715 requirement 1: the give-up branch ────────────────────────────

(defn- inbox-dir [project-root state]
  (str (fs/path project-root ".swarmforge" "handoffs" "inbox" (name state))))

(defn- complete-in-process-as-given-up!
  "Stamps `outcome: given-up` and `outcome_seat: role` onto THIS seat's own
   in-process parcel file and moves it to completed/ - the local seat's
   own bookkeeping for the ticket it just gave up, never a git_handoff
   forward. The stamp IS the durable per-(ticket, seat) marker
   handoff_lib.bb's given-up-task-names-in/worked-task-names-in read back
   later (no separate store)."
  [project-root role]
  (let [dir (inbox-dir project-root :in_process)
        f (some->> (when (fs/exists? dir) (fs/list-dir dir))
                   (filter #(str/ends-with? (str %) ".handoff"))
                   first)]
    (when f
      (let [text (slurp (str f))
            stamped (str (str/trim-newline text) "\noutcome: given-up\noutcome_seat: " role "\n")
            target (fs/path (inbox-dir project-root :completed) (fs/file-name f))]
        (fs/create-dirs (fs/parent target))
        (spit (str target) stamped)
        (fs/delete f)))))

(defn- commit-shas-since
  "Newest-first commit shas strictly after since-sha, up to and including
   HEAD."
  [checkout since-sha]
  (->> (str/split-lines (:out (git! checkout "log" "--format=%H" (str since-sha "..HEAD"))))
       (remove str/blank?)))

(defn- merge-commit-sha? [checkout sha]
  (> (count (str/split (str/trim (or (:out (git! checkout "log" "-1" "--format=%P" sha)) "")) #"\s+"))
     1))

(defn revert-to-pre-claim!
  "Reverts every commit made since pre-claim-head, newest first, via `git
   revert` (a non-merge commit reverted plainly, a merge with `-m 1`) -
   never `git reset`, which would rewrite history (A Bounce Must Be
   Reverted Out Of The Bouncing Branch's own discipline: revert, not
   reset). A no-op when pre-claim-head is unknown or already HEAD."
  [checkout pre-claim-head]
  (when (and pre-claim-head (not= (head-sha checkout) pre-claim-head))
    (doseq [sha (commit-shas-since checkout pre-claim-head)]
      (if (merge-commit-sha? checkout sha)
        (git! checkout "revert" "--no-edit" "-m" "1" sha)
        (git! checkout "revert" "--no-edit" sha)))))

(defn- handoff-timestamp-token []
  (-> (str (java.time.Instant/now))
      (str/replace #"[-:]" "")
      (str/replace #"\.\d+Z$" "Z")))

(defn- requeue-parcel!
  "Writes a fresh git_handoff draft naming the SAME task, received commit
   and priority directly into the stage's shared queue, so any seat of the
   stage (a Claude seat included) claims it on its own next poll with no
   deferral (handoff_lib.bb's worked-task-names-in excludes the given-up
   completion) - the seat that gave it up is excluded permanently instead
   (given-up-task-names-in), never by this fresh copy."
  [project-root role sender ticket commit priority]
  (let [dir (inbox-dir project-root :new)
        fname (str "00_" (handoff-timestamp-token) "_" (format "%06d" (rand-int 1000000))
                   "_from_" sender "_to_" role "_for_" role ".handoff")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir fname))
          (str "type: git_handoff\n"
               "from: " sender "\n"
               "to: " role "\n"
               "priority: " (or priority "50") "\n"
               "task: " ticket "\n"
               "commit: " commit "\n"
               "\n"
               "merge_and_process " sender " " commit "\n"))))

(defn give-up!
  "BL-1715 requirement 1: the last fix turn still fails and this stage has
   a non-driver sibling seat - give the parcel up rather than
   escalate-and-hold. Spec write permission is restored first, as on every
   other exit path. The revert (never reset) brings the seat's tree back
   to exactly its pre-claim state; the fresh re-queued copy is what a
   sibling seat's next poll claims."
  [ctx state reason]
  (let [{:keys [project-root checkout role seat-id agent]} ctx
        {:keys [ticket senderRole commit priority preClaimHead fixTurnsUsed startedAtMs]} state]
    (restore-spec-writable! state)
    (record-outcome! project-root
                      {:seat-id seat-id :model agent :ticket ticket :outcome "given-up"
                       :reason reason :fix-turns-used fixTurnsUsed :wall-ms (driver-wall-ms startedAtMs)})
    (complete-in-process-as-given-up! project-root role)
    (revert-to-pre-claim! checkout preClaimHead)
    (requeue-parcel! project-root role senderRole ticket commit priority)
    (clear-driver-state! project-root seat-id)))

(defn run-gate!
  "Step 6-7, called once the pane is confirmed idle. BL-1715: when the last
   fix turn still fails and this stage has a non-driver sibling seat, the
   parcel is given up (give-up!) rather than escalated-and-held."
  [ctx state]
  (let [{:keys [project-root checkout role seat-id agent socket session]} ctx
        {:keys [ticket postMergeHead specFiles specHashesBefore editablePaths acceptancePath
                fixTurnsUsed fixTurnsLimit startedAtMs]} state
        gate-result (seat-test! checkout role ticket acceptancePath)
        commit-count (commit-count-since checkout postMergeHead)
        touched (touched-paths-since checkout postMergeHead)
        spec-now (into {} (map (fn [p] [p (file-sha256 p)]) specFiles))
        decision (green-gate-decision
                  {:acceptance-passes? (zero? (:exit gate-result))
                   :has-commit? (pos? commit-count)
                   :spec-bytes-identical? (= specHashesBefore spec-now)
                   :touched-paths touched
                   :editable-set (set editablePaths)})]
    (if (:pass decision)
      (let [ticket-content (slurp (str (fs/path checkout "backlog" "active" (str ticket ".yaml"))))
            field (required-stages-lib/read-required-stages ticket-content)
            effective (:effective (required-stages-lib/resolve-effective field))
            next-role (required-stages-lib/next-required-stage effective role)]
        (restore-spec-writable! state)
        (when next-role
          (seat! checkout role ["handoff" next-role ticket]))
        (seat! checkout role ["done"])
        (record-outcome! project-root {:seat-id seat-id :model agent :ticket ticket :outcome "handed-off"
                                        :reason nil :fix-turns-used fixTurnsUsed
                                        :wall-ms (driver-wall-ms startedAtMs)})
        (clear-driver-state! project-root seat-id))
      (if (< fixTurnsUsed fixTurnsLimit)
        (do (chat-set-up! ctx state)
            (type-raw! socket session agent (fix-request-text ticket (:reason decision)))
            (write-driver-state! project-root seat-id (assoc state :fixTurnsUsed (inc fixTurnsUsed))))
        (if (has-non-driver-sibling? project-root role)
          (give-up! ctx state (:reason decision))
          (do (restore-spec-writable! state)
              (escalate! ctx ticket (:reason decision))
              (record-outcome! project-root {:seat-id seat-id :model agent :ticket ticket :outcome "escalated"
                                              :reason (:reason decision) :fix-turns-used fixTurnsUsed
                                              :wall-ms (driver-wall-ms startedAtMs)})
              (write-driver-state! project-root seat-id (assoc state :escalated true :reason (:reason decision)))))))))

(defn drive-tick!
  "Advances one seat's driver state by exactly as much as is ready this
   tick - never blocks waiting for the model. handoffd's own poll cadence
   calls this once per cycle for every live driver seat; a test drives it
   in a tight loop until the parcel reaches a terminal state (handed off
   or escalated). An escalated hold checks once for a waiting human
   answer (requirement 2, a no-op when there is none); a \"post-merge\"
   phase resumes the ticket flow without re-merging (requirement 1)."
  [ctx]
  (let [{:keys [project-root seat-id socket session]} ctx
        state (read-driver-state project-root seat-id)]
    (cond
      (:escalated state)
      (resume-from-hold! ctx state)

      (nil? state)
      (start-new-parcel! ctx)

      (= "post-merge" (:phase state))
      (continue-after-merge! ctx state)

      (= "awaiting-model" (:phase state))
      (when (turn-idle? (agent-runtime-inject/capture-pane-text socket session))
        (run-gate! ctx state)))))

(defn drive-to-end!
  "Test/CLI convenience: ticks until the seat's state reaches a terminal
   condition (no state file, or escalated with no tick since having
   become so) or max-ticks is exhausted - never used by the live daemon,
   which calls drive-tick! once per its own cycle instead.
   prev-escalated? (BL-1698): an ALREADY-escalated hold still gets ONE
   tick before the loop treats it as terminal, so a waiting human answer
   (requirement 2) gets its chance to resolve it - a hold that becomes
   escalated freshly DURING this loop still stops promptly (one more,
   harmless tick after it does, same as before this ticket)."
  [ctx & {:keys [max-ticks poll-interval-ms] :or {max-ticks 200 poll-interval-ms 10}}]
  (loop [n 0
         prev-escalated? false]
    (let [state (read-driver-state (:project-root ctx) (:seat-id ctx))]
      (if (or (>= n max-ticks)
              (and (:escalated state) prev-escalated?)
              (and (nil? state) (pos? n)))
        state
        (do (drive-tick! ctx)
            (Thread/sleep (long poll-interval-ms))
            (recur (inc n) (boolean (:escalated state))))))))
