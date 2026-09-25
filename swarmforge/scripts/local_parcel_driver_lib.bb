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

(defn start-new-parcel!
  "Step 1-5. Returns nil when there is nothing to serve this tick."
  [ctx]
  (let [{:keys [project-root checkout role seat-id agent socket session fix-turns-limit]} ctx
        served (seat! checkout role ["next"])]
    (when (zero? (:exit served))
      (let [in-process-dir (fs/path checkout ".swarmforge" "handoffs" "inbox" "in_process")
            parcel-file (some->> (when (fs/exists? in-process-dir) (fs/list-dir in-process-dir))
                                  (filter #(str/ends-with? (str %) ".handoff"))
                                  first)]
        (when parcel-file
          (let [parcel-text (slurp (str parcel-file))
                sender (read-yaml-field parcel-text "from")
                commit (read-yaml-field parcel-text "commit")
                ticket (read-yaml-field parcel-text "task")
                ticket-yaml-path (str (fs/path checkout "backlog" "active" (str ticket ".yaml")))]
            (when-not (fs/exists? ticket-yaml-path)
              ;; Named by the parcel but not (yet) visible in this
              ;; checkout - the same "merge main first" condition every
              ;; Claude role hits (BL-1614); merge before reading it.
              (git! checkout "fetch" "origin" "main")
              (git! checkout "merge" "origin/main" "-m" (format "Merge main into %s.\n\nBy coder." role)))
            (let [ticket-content (slurp ticket-yaml-path)
                  acceptance-path (ticket-acceptance-path ticket-content)
                  acceptance-full (str (fs/path checkout acceptance-path))
                  merge-result (seat! checkout role ["merge" sender commit])]
              (cond
                (= 3 (:exit merge-result))
                (do (escalate! ctx ticket "merge conflict")
                    (write-driver-state! project-root seat-id {:escalated true :ticket ticket :reason "merge conflict"}))

                (not (zero? (:exit merge-result)))
                (do (escalate! ctx ticket "merge conflict")
                    (write-driver-state! project-root seat-id {:escalated true :ticket ticket :reason "merge conflict"}))

                :else
                (let [post-merge-head (head-sha checkout)
                      red (seat-test! checkout role ticket acceptance-full)
                      red-decision (red-check-decision (zero? (:exit red)))]
                  (if-not (:pass red-decision)
                    (do (escalate! ctx ticket (:reason red-decision))
                        (write-driver-state! project-root seat-id
                                              {:escalated true :ticket ticket :reason (:reason red-decision)}))
                    (let [editable (->> (editable-paths ticket-content)
                                         (remove forbidden-chat-path?)
                                         vec)
                          spec-files [ticket-yaml-path acceptance-full]
                          spec-hashes (into {} (map (fn [p] [p (file-sha256 p)]) spec-files))]
                      (chat-clear! socket session agent)
                      (doseq [p spec-files] (chat-read-only! socket session agent p))
                      (doseq [p editable] (chat-add! socket session agent (str (fs/path checkout p))))
                      (doseq [p spec-files] (set-writable! p false))
                      (type-raw! socket session agent (instruction-text ticket))
                      (write-driver-state!
                       project-root seat-id
                       {:phase "awaiting-model"
                        :ticket ticket
                        :senderRole sender
                        :postMergeHead post-merge-head
                        :specFiles spec-files
                        :specHashesBefore spec-hashes
                        :editablePaths editable
                        :fixTurnsUsed 0
                        :fixTurnsLimit (or fix-turns-limit default-fix-turns)
                        :acceptancePath acceptance-full}))))))))))))

(defn run-gate!
  "Step 6-7, called once the pane is confirmed idle."
  [ctx state]
  (let [{:keys [project-root checkout role seat-id agent socket session]} ctx
        {:keys [ticket postMergeHead specFiles specHashesBefore editablePaths acceptancePath fixTurnsUsed fixTurnsLimit]} state
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
        (clear-driver-state! project-root seat-id))
      (if (< fixTurnsUsed fixTurnsLimit)
        (do (type-raw! socket session agent (fix-request-text ticket (:reason decision)))
            (write-driver-state! project-root seat-id (assoc state :fixTurnsUsed (inc fixTurnsUsed))))
        (do (restore-spec-writable! state)
            (escalate! ctx ticket (:reason decision))
            (write-driver-state! project-root seat-id (assoc state :escalated true :reason (:reason decision))))))))

(defn drive-tick!
  "Advances one seat's driver state by exactly as much as is ready this
   tick - never blocks waiting for the model. handoffd's own poll cadence
   calls this once per cycle for every live driver seat; a test drives it
   in a tight loop until the parcel reaches a terminal state (handed off
   or escalated)."
  [ctx]
  (let [{:keys [project-root seat-id socket session]} ctx
        state (read-driver-state project-root seat-id)]
    (cond
      (:escalated state) nil

      (nil? state)
      (start-new-parcel! ctx)

      (= "awaiting-model" (:phase state))
      (when (turn-idle? (agent-runtime-inject/capture-pane-text socket session))
        (run-gate! ctx state)))))

(defn drive-to-end!
  "Test/CLI convenience: ticks until the seat's state reaches a terminal
   condition (no state file, or escalated) or max-ticks is exhausted -
   never used by the live daemon, which calls drive-tick! once per its
   own cycle instead."
  [ctx & {:keys [max-ticks poll-interval-ms] :or {max-ticks 200 poll-interval-ms 10}}]
  (loop [n 0]
    (let [state (read-driver-state (:project-root ctx) (:seat-id ctx))]
      (if (or (>= n max-ticks) (:escalated state) (and (nil? state) (pos? n)))
        state
        (do (drive-tick! ctx)
            (Thread/sleep (long poll-interval-ms))
            (recur (inc n)))))))
