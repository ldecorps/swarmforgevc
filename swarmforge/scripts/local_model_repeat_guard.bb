#!/usr/bin/env bb
;; local_model_repeat_guard.bb - the qwen PostToolUse hook a local-model
;; seat's .qwen/settings.json runs after every tool call
;; (write_local_model_qwen_settings in swarmforge.sh registers it).
;;
;; Why (2026-10-04): the iq3 coder, holding a BL-1951 bounce it had already
;; resolved, re-ran the same thirteen `git log ... && git show` commands in
;; a cycle, each up to seven times, for ten minutes with no edit - while
;; both of its compaction summaries said "Stop the ancestry trace ... write
;; tmp/handoff.txt". qwen's own loop detection is off on these seats
;; (skipLoopDetection): its dialog halts a one-shot seat's turn for good.
;;
;; When the seat makes a tool call it has already made, with the same
;; arguments, twice since the last thing that can change what the call
;; returns - an edit or write_file, a compaction (the seat's context lost
;; the output), or a shell command that changes the repo or the mailbox (a
;; commit, merge, checkout, restore, reset, rebase, or one of the handoff
;; scripts) - this answers with additionalContext, which qwen hands the
;; model with the call's result: the call is a repeat, its output has not
;; changed, and the next step the latest compaction summary named. Edits
;; and the state-changing commands are never warned about, and an
;; unreadable transcript or event adds nothing.
;;
;; It warns rather than refuses. The first version (66bd85171f) refused the
;; call as a PreToolUse deny; the iq3 coder then re-sent the identical call
;; every five seconds, which tripped qwen's always-on check for consecutive
;; identical tool calls (skipLoopDetection does not turn it off), and its
;; interactive loop dialog halted the one-shot seat's turn (20:25Z). A
;; result the model already has gives it nothing to retry.

(ns local-model-repeat-guard
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

;; BL-1992: *file* is only correctly bound to THIS file while its own
;; top-level forms load; a defn body that reads *file* resolves whatever
;; is loading at CALL time instead (another script's own path, or
;; "NO_SOURCE_PATH" from a bare -e), the wrong directory entirely. Captured
;; once here, at load time, the way ready_for_next_task.bb's own
;; script-dir already is.
(def script-dir (fs/parent (fs/canonicalize *file*)))

;; BL-1992 D1/D2 (QA bounce): the ticket a release note names is resolved
;; the same way chase_sweep_lib.bb's own dispatch-trail-ticket-id already
;; does for a `task:` header (pipeline-stage-lib/extract-ticket-id - a
;; \b-bounded prefix+digits match, correct against a bare id or a full
;; stable-task-name slug alike) and for a Work note's `message:` header
;; (work-note-evidence-lib/work-note-ticket-id-from-message, already
;; bare-only). Both pure libs; loaded, never restated.
(load-file (str (fs/path script-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path script-dir "work_note_evidence_lib.bb")))

(def max-repeats
  "Identical calls in one window before the next one is warned about."
  2)

(def edit-tools #{"edit" "write_file"})

(def state-changing-commands
  ;; ready_for_next.sh is intentionally absent: when a seat already holds
  ;; in_process work the script only reprints STOP + TASK and changes
  ;; nothing. Counting it as a reset let the iq3 QA seat re-run it forever
  ;; after a STOP banner without ever seeing a REPEAT note (live 2026-09-30
  ;; compliance battery: coder-stop_banner_compliance). A successful claim
  ;; still leaves the window alone - the seat's next edit/commit/handoff
  ;; resets it. done_with_current and swarm_handoff remain resets because
  ;; they move the mailbox.
  ["git commit" "git merge" "git checkout" "git switch" "git restore"
   "git reset" "git rebase" "git cherry-pick" "git revert" "git stash"
   "swarm_handoff.sh" "done_with_current.sh"])

(def noise-keys
  "Argument keys that do not change what a call returns."
  ["description" "is_background" "timeout"])

(defn call-key [name args]
  [name (apply dissoc (if (map? args) args {}) noise-keys)])

(defn resets-window? [{:keys [kind name args]}]
  (or (= kind :compaction)
      (contains? edit-tools name)
      (and (= name "run_shell_command")
           (let [command (str (get args "command"))]
             (some #(str/includes? command %) state-changing-commands)))))

(defn next-step-of
  "The <next_step> text a compaction summary names, or nil."
  [payload]
  (let [text (->> (tree-seq coll? seq payload) (filter string?) (str/join "\n"))]
    (some-> (re-find #"(?s)<next_step>(.*?)</next_step>" text) second str/trim not-empty)))

(defn- message-text
  "The text of a \"user\"-type record's message, or nil - qwen's own
   real-user turns carry it as message.parts[].text (BL-2064: distinct
   from a \"tool_result\" record, which also has message.role \"user\" but
   its own \"type\" value, so the \"type\" check above already excludes it)."
  [record]
  (->> (get-in record ["message" "parts"])
       (keep #(get % "text"))
       (str/join "\n")
       not-empty))

(defn transcript-entries
  "Tool calls, compactions and user messages in transcript order, from
   qwen's session JSONL lines; each call carries :record, the index of the
   assistant record that made it. A line that does not parse is skipped."
  [lines]
  (apply concat
         (map-indexed
          (fn [i line]
            (let [record (try (json/parse-string line) (catch Exception _ nil))]
              (cond
                (not (map? record)) []
                (and (= "system" (get record "type"))
                     (= "chat_compression" (get record "subtype")))
                [{:kind :compaction :next-step (next-step-of (get record "systemPayload"))}]
                (= "assistant" (get record "type"))
                (for [part (get-in record ["message" "parts"])
                      :let [call (get part "functionCall")]
                      :when (map? call)]
                  {:kind :call :record i :name (get call "name") :args (get call "args")})
                (= "user" (get record "type"))
                [{:kind :user :text (message-text record)}]
                :else [])))
          lines)))

(defn- without-in-flight
  "qwen writes a model turn's calls to the transcript before it runs them,
   so the call being decided is already in the last assistant record. Drop
   that one occurrence; nothing is dropped when the record does not hold it."
  [entries k]
  (let [last-record (some :record (rseq entries))
        idx (some (fn [[i e]] (when (and (= last-record (:record e))
                                         (= k (call-key (:name e) (:args e))))
                                i))
                  (map-indexed vector entries))]
    (if idx
      (into (subvec entries 0 idx) (subvec entries (inc idx)))
      entries)))

(defn prior-repeats
  "How many times the call (name, args) was already made in the current
   window, not counting the in-flight call itself."
  [entries name args]
  (let [k (call-key name args)
        entries (without-in-flight (vec entries) k)
        window (reverse (take-while (complement resets-window?) (rseq entries)))]
    (count (filter #(and (= :call (:kind %)) (= k (call-key (:name %) (:args %)))) window))))

(defn latest-next-step [entries]
  (some :next-step (reverse (filter #(= :compaction (:kind %)) entries))))

(defn session-first-message
  "The text of the session's very first user message, or nil - BL-2064's
   fallback restart message when no compaction has run yet (a seat can
   overrun the read budget on its very first turn, before any compaction)."
  [entries]
  (some #(when (= :user (:kind %)) (:text %)) entries))

;; ── BL-2064: warn, then restart, a seat that reads without writing ──
;;
;; The human, live: "compressions for iq3 are lethal, it just compacted
;; and immediately goes on a reading frenzy." Measured since 2026-10-04:
;; 61% of the iq3 coder's model time went to read-only calls, and 39% was
;; reading a compaction then discarded before any edit. The card already
;; says "read only what the ticket names"; the seat does not.
;;
;; A compaction's own reset status was the first bug found here: the
;; ticket's original invariant reset this counter on exactly what
;; resets-window? resets, including a bare compaction - but a compaction
;; is exactly when the seat has just lost its context and is most likely
;; to re-read everything to rebuild it, so resetting the budget there
;; hands it a fresh 12 reads right when it is most likely to burn them -
;; the "reading frenzy" the human watched happen. read-budget-resets?
;; below is a sibling of resets-window? that drops the compaction clause:
;; an edit/write_file or a state-changing shell command resets the read
;; budget, a compaction does not. (The warning half of this shipped ahead
;; of the rest as hotfix 9b89a6e5db; this build carries the same
;; read-budget-resets? forward and adds the restart half.)
;;
;; At the 24th qualifying read since the last reset, the seat is
;; restarted the same way a missed write restarts it (BL-1991), drawing
;; on the same per-parcel restart count (BL-1992): once both restarts are
;; already spent, the overrun releases the parcel instead. The fresh
;; turn's only message is the latest compaction's next step, or - a seat
;; can overrun the budget on its very first turn, before any compaction -
;; the session's first message (session-first-message above).

(def read-warn-at
  "A qualifying read-only call is warned about from this count onward,
   since the last reset (never a bare compaction - see above)."
  12)

(def read-restart-at
  "A qualifying read-only call at or past this count, since the last
   reset, restarts the seat (BL-1991's own path) rather than merely
   warning it."
  24)

(def read-only-tools #{"read_file" "read_many_files" "grep_search" "glob" "list_directory"})

(def read-only-command-pattern
  "A shell command whose own output cannot change the repo or the
   mailbox: the existing read-commands list, `sed -n`, and the read-only
   git subcommands - matched only at the start of the (trimmed) command,
   the same way command-base already reads a command's leading word."
  #"^(?:ls|cat|head|tail|wc|grep|find|stat|sed\s+-n|git\s+(?:show|log|diff|grep|ls-files|blame|status))\b")

(defn read-only-shell-command? [cmd]
  (boolean (and (string? cmd) (re-find read-only-command-pattern (str/trim cmd)))))

(defn read-type-call?
  "True for a call whose own result cannot change the repo or the
   mailbox - the kind of call the read budget counts."
  [{:keys [kind name args]}]
  (and (= kind :call)
       (or (contains? read-only-tools name)
           (and (= name "run_shell_command")
                (read-only-shell-command? (get args "command"))))))

(defn read-budget-resets?
  "resets-window? without its compaction clause (see above): only an
   edit/write_file or a state-changing shell command starts the read
   budget's window over."
  [{:keys [kind name args]}]
  (or (contains? edit-tools name)
      (and (= kind :call) (= name "run_shell_command")
           (let [command (str (get args "command"))]
             (some #(str/includes? command %) state-changing-commands)))))

(defn reads-since-write
  "How many read-type calls were already made since the last reset, not
   counting the in-flight call itself. Entries between the reset and now
   that are neither a read-type call nor a reset (a compaction, or any
   other call) pass through uncounted - only read-type calls advance the
   budget."
  [entries name args]
  (let [k (call-key name args)
        entries (without-in-flight (vec entries) k)
        window (reverse (take-while (complement read-budget-resets?) (rseq entries)))]
    (count (filter read-type-call? window))))

(defn read-budget-note
  "The note to hand the model with this call's result, or nil: only for a
   read-type in-flight call (this is the scenario the human reported,
   and it keeps the note out of calls the budget does not track), once
   the qualifying read count since the last reset reaches read-warn-at
   and before it reaches read-restart-at (answer's cond takes the restart
   branch at and past that point, so this never double-fires with it)."
  [entries name args]
  (when (read-type-call? {:kind :call :name name :args args})
    (let [total (inc (reads-since-write entries name args))]
      (when (and (>= total read-warn-at) (< total read-restart-at))
        (str "READ-BUDGET: this is your " total "th read since your last edit or"
             " state-changing command, with no write in between. A compaction does"
             " not reset this count - rebuilding context is not a reason to keep reading."
             " Your next call should be the change your ticket names, or writing your"
             " plan to tmp/notes.md if you are still in the arrange phase."
             (when-let [step (latest-next-step entries)]
               (str " Your last summary named this next step: "
                    (subs step 0 (min 300 (count step))))))))))

(defn read-budget-step
  "The fresh turn's only message, before the '24 reads' line below is
   appended: the latest compaction's next step, else the session's first
   message - the human's own fallback order for this restart."
  [entries]
  (or (latest-next-step entries) (session-first-message entries)))

(defn read-budget-override-message
  "Unlike a missed write's override-message, there is no named file path
   to point the seat at - the ticket names no single file for \"read too
   much\", only the change it was already told to make. The step text (or
   its session's-first-message fallback) carries that; this just says why
   the turn is fresh."
  [step reads]
  (str step "\n\nYour last session made " reads " reads since its last edit or"
       " state-changing command, with no write in between. Do not re-read what you"
       " already read: make the change above now."))

(defn read-budget-overrun
  "{:step :reads}, or nil, for this in-flight call: only a read-type call
   counts (same guard read-budget-note uses), and only once the
   qualifying count since the last reset - including this call - reaches
   read-restart-at."
  [entries name args]
  (when (read-type-call? {:kind :call :name name :args args})
    (let [total (inc (reads-since-write entries name args))]
      (when (>= total read-restart-at)
        {:step (read-budget-step entries) :reads total}))))

;; read-budget-restart-decision and read-budget-release-decision are
;; defined below, beside restart-decision/release-decision, once
;; max-restarts exists - the same per-parcel count a missed write draws
;; on (BL-1991/1992).

;; ── BL-1991: restart a seat that skips the write its compaction named ──
;;
;; On 2026-10-05 the iq3 coder, holding BL-1928, merged main and never
;; wrote: one turn ran 261 model steps across six compactions, every one of
;; them naming the same next step (write a named file), and the model
;; answered each by reading more. qwen's loop check is off for this seat
;; (skipLoopDetection), so nothing ended the turn. The human's trial: when
;; the latest compaction names a write or an edit and the seat then makes
;; three tool calls that are not that write, end qwen and start a fresh one
;; whose only message is that next step. A seat that writes first is left
;; alone, and a parcel gets at most two such restarts - the third miss is
;; BL-1992, not this hook's job. No tool call is ever refused.

(def max-restarts
  "A parcel is restarted at most this many times for a missed write."
  2)

(defn named-write-path
  "The file path a next-step's text names as a write or an edit, or nil
   when it names neither a write/edit verb or no file path at all (scenario
   04: a next step that names no write never restarts the seat)."
  [next-step]
  (when (and next-step (re-find #"(?i)\b(write|writes|edit|edits)\b" next-step))
    (some-> (re-find #"(/?[A-Za-z0-9_.][A-Za-z0-9_./-]*/[A-Za-z0-9_./-]*\.[A-Za-z0-9]+)" next-step)
            second
            str/trim)))

(defn- resolved-path [cwd p]
  "p resolved against cwd: an absolute path is itself, a relative one is
   joined under cwd - so a named path and a call's file_path compare as
   the same file no matter which form each was written in."
  (let [f (if (str/starts-with? p "/") (io/file p) (io/file (or cwd ".") p))]
    (try (str (fs/canonicalize f)) (catch Exception (str f)))))

(defn- named-write-call? [path cwd entry]
  (and (= :call (:kind entry))
       (contains? edit-tools (:name entry))
       (let [fp (get (:args entry) "file_path")]
         (and (string? fp)
              (= (resolved-path cwd path) (resolved-path cwd fp))))))

(defn calls-since-compaction
  "Entries strictly after the latest compaction; every entry when there is
   none."
  [entries]
  (let [v (vec entries)
        idx (->> (map-indexed vector v)
                 (filter #(= :compaction (:kind (second %))))
                 last
                 first)]
    (if idx (subvec v (inc idx)) v)))

(defn missed-write
  "{:next-step :path}, or nil, for this in-flight call: the latest
   compaction must name a write/edit path, that write must not already
   have happened since that compaction, this call must not be that write,
   and it must be the third such call since that compaction. Says nothing
   about the restart count - restart-decision and release-decision (BL-1992)
   each decide what this miss means for a parcel at their own count."
  [entries name args cwd]
  (let [step (latest-next-step entries)
        path (named-write-path step)]
    (when path
      (let [stripped (without-in-flight (vec entries) (call-key name args))
            since (calls-since-compaction stripped)
            already-written? (some #(named-write-call? path cwd %) since)
            other (count (remove #(named-write-call? path cwd %)
                                  (filter #(= :call (:kind %)) since)))
            this-write? (and (contains? edit-tools name)
                             (named-write-call? path cwd
                                                 {:kind :call :name name :args args}))]
        (when (and (not already-written?)
                   (not this-write?)
                   (>= (inc other) 3))
          {:next-step step :path path})))))

(defn restart-decision
  "A missed write restarts the seat only while the parcel has not already
   used both of its restarts."
  [entries name args cwd restart-count]
  (when (< restart-count max-restarts)
    (missed-write entries name args cwd)))

;; ── BL-1992: the third miss releases the parcel instead of restarting ──
;;
;; The human's trial goes on: "On the third miss, do not restart: the
;; parcel must leave in_process, and a note must name the ticket so the
;; other coder seat can take it." A missed write once both of BL-1991's
;; restarts are already spent is this, never a third restart request.

(defn release-decision
  "The same missed write as restart-decision, but only once the parcel's
   restarts are already exhausted."
  [entries name args cwd restart-count]
  (when (>= restart-count max-restarts)
    (missed-write entries name args cwd)))

;; ── BL-2064: a read-budget overrun draws on the same per-parcel count ──

(defn read-budget-restart-decision
  "A read-budget overrun restarts the seat only while the parcel has not
   already used both of its restarts - the same per-parcel count a missed
   write draws on (BL-1991)."
  [entries name args restart-count]
  (when (< restart-count max-restarts)
    (read-budget-overrun entries name args)))

(defn read-budget-release-decision
  "The same read-budget overrun as read-budget-restart-decision, but only
   once the parcel's restarts are already exhausted (BL-1992)."
  [entries name args restart-count]
  (when (>= restart-count max-restarts)
    (read-budget-overrun entries name args)))

;; BL-2055 (QA-reported D2 of its own kind - the coordinator's note
;; 017189): a sidecar left behind by BL-1992's own release (which moves
;; only the handoff file, never its .claim-progress.json) is not a held
;; parcel - reading it as one restarted the seat on the ticket it had
;; just released. Copied from handoff_lib.bb's sidecar-suffixes rather
;; than load-filed (measured: loading handoff_lib.bb costs ~100ms more
;; than this hook's own baseline, and it runs on every tool call) - kept
;; in agreement by test_bl1971_local_model_repeat_guard.sh (BL-897).
(def sidecar-suffixes [".nudge" ".chase.json" ".claim-progress.json" ".batch-claim-progress.json"])

(defn- sidecar-name? [name]
  (boolean (some #(str/ends-with? name %) sidecar-suffixes)))

(defn- in-process-handoff-name
  "The name of this role's current in_process handoff file - stable across
   a restart (the parcel is never completed or handed off), so it is the
   restart count's key: a later, different parcel's different file name
   starts fresh with no reset needed. nil when there is none (no restart
   state applies outside a real parcel) - including when in_process holds
   only a sidecar (BL-2055): BL-1992's release moves only the handoff file,
   so a leftover claim-progress sidecar must never read as a new parcel."
  [cwd]
  (let [dir (io/file cwd ".swarmforge" "handoffs" "inbox" "in_process")]
    (when (.isDirectory dir)
      (some->> (.listFiles dir)
               (filter #(.isFile %))
               (map #(.getName %))
               (remove sidecar-name?)
               sort
               first))))

(defn restart-state-file
  "Where this parcel's durable restart count lives, or nil outside a real
   parcel."
  [cwd]
  (when-let [k (in-process-handoff-name cwd)]
    (io/file cwd ".swarmforge" "local-seat-restart" (str k ".json"))))

(defn read-restart-count [state-file]
  (if (and state-file (.exists ^java.io.File state-file))
    (try (or (get (json/parse-string (slurp state-file)) "restarts") 0)
         (catch Exception _ 0))
    0))

(defn override-message
  "The fresh turn's only user message: the named next step, told to make
   the named change. The file may already exist - a next step that names
   an edit does - so the message names it at its absolute path and tells
   the seat to read only the lines it will change first, never not to
   read the file; only a missing file is told to be written without
   reading it first."
  [next-step path cwd]
  (let [exists? (and (string? cwd)
                     (.exists (java.io.File. ^String (resolved-path cwd path))))]
    (str next-step "\n\n"
         (if exists?
           (str "Edit " (resolved-path cwd path) " now. Read only the lines you will change first (grep -n, then read_file with offset and limit), then edit them.")
           (str "Write " path " now. Do not read " path
                " first - it does not exist yet.")))))

(defn- write-restart-state!
  "Bumps the durable restart count and writes the pending override message
   under .swarmforge/ for the launcher to relaunch qwen with - shared by
   every restart reason (a missed write, BL-1991; a read-budget overrun,
   BL-2064), since they draw on the same per-parcel count."
  [state-file message restart-count]
  (io/make-parents ^java.io.File state-file)
  (spit state-file (json/generate-string {"restarts" (inc restart-count)}))
  (spit (io/file (str state-file ".msg")) message))

(defn write-restart-request!
  [state-file next-step path cwd restart-count]
  (write-restart-state! state-file (override-message next-step path cwd) restart-count))

(defn write-read-budget-restart-request!
  [state-file step reads restart-count]
  (write-restart-state! state-file (read-budget-override-message step reads) restart-count))

(defn end-qwen-process!
  "Ends this hook's parent process - qwen spawns the PostToolUse hook as a
   direct child for every call. A fresh qwen relaunch is the launcher's
   job, reading the pending override this writes (BL-1991)."
  []
  (when-let [parent (.orElse (.parent (java.lang.ProcessHandle/current)) nil)]
    (.destroy ^java.lang.ProcessHandle parent)))

;; ── BL-1992: release the parcel instead of a third restart ─────────────

(defn- in-process-handoff-path
  "The full path of this role's current in_process handoff file, or nil
   outside a real parcel - same cwd-only resolution in-process-handoff-name
   already uses, never this process's own working directory."
  [cwd]
  (when-let [name (in-process-handoff-name cwd)]
    (io/file cwd ".swarmforge" "handoffs" "inbox" "in_process" name)))

(defn- handoff-header [content field]
  "One header's value from a handoff file's content, or nil - a plain
   regex read, matching this file's own self-contained style rather than
   loading handoff_lib.bb's full header parser."
  (some-> (re-find (re-pattern (str "(?m)^" field ":\\s*(.+)$")) (or content "")) second str/trim))

(defn task-name-from-handoff
  "The released ticket's bare id, from the handoff's own task: header (a
   git_handoff - resolved through extract-ticket-id, correct whether the
   header carries a bare id or a full stable-task-name slug) or, absent
   that, a Work note's message: header (work-note-ticket-id-from-message,
   already bare-only) - or nil when neither names one. Never the raw
   header text itself: D2's own repro showed a slug task name, embedded
   whole, breaks both the 80-char note limit and the point of naming a
   ticket at all."
  [content]
  (or (some-> (handoff-header content "task") pipeline-stage-lib/extract-ticket-id)
      (work-note-evidence-lib/work-note-ticket-id-from-message (handoff-header content "message"))))

(defn release-note-message
  "The coordinator note's message (note-only, max 80 chars - Article 2.2):
   names the released ticket so another coder seat can take it. ticket is
   always a bare id (task-name-from-handoff's own contract) or the \"its
   ticket\" fallback, both comfortably under the limit."
  [ticket]
  (str ticket " released: third missed write; another coder seat can take it"))

(defn send-release-note!
  "Shells to swarm_handoff.sh (Article 2.3: agents send only through it,
   never writing inbox/new/ directly) with cwd as the working directory -
   never this process's own - so the note lands in the SEAT's own outbox,
   never wherever this hook process happens to be running from. Returns
   true only on a real, confirmed send (BL-1992 D2: the caller must know
   whether the note actually went out before giving up the parcel)."
  [cwd message]
  (let [script (str (fs/path script-dir "swarm_handoff.sh"))
        draft (io/file cwd "tmp" "bl1992-release-note.txt")]
    (io/make-parents draft)
    (spit draft (str "type: note\nto: coordinator\npriority: 10\nmessage: " message "\n"))
    (try
      (zero? (:exit @(process/shell {:dir cwd :out :string :err :string :continue true} script (str draft))))
      (catch Exception _ false))))

(defn release-parcel!
  "Sends the coordinator a note naming the released ticket FIRST, and only
   on a confirmed send moves the parcel's in_process handoff to this
   seat's own inbox/abandoned (the destination the coordinator's own pull
   already uses, so nothing keeps routing it to this seat). BL-1992 D2: a
   refused or failed send must never strand the parcel silently with
   nothing sent and the file already moved - a failed send leaves the
   parcel exactly where it was, in_process, for the next miss (or a human)
   to find, and prints why. Best-effort outside a real parcel: nothing to
   release when there is no in_process handoff."
  [cwd]
  (when-let [src (in-process-handoff-path cwd)]
    (when (.isFile ^java.io.File src)
      (let [content (slurp src)
            ticket (or (task-name-from-handoff content) "its ticket")
            sent? (send-release-note! cwd (release-note-message ticket))]
        (if sent?
          (let [dest-dir (io/file cwd ".swarmforge" "handoffs" "inbox" "abandoned")]
            (io/make-parents (io/file dest-dir "x"))
            (io/copy src (io/file dest-dir (.getName ^java.io.File src)))
            (io/delete-file src true))
          (binding [*out* *err*]
            (println (str "local_model_repeat_guard.bb: release note for " ticket
                          " was not confirmed sent; the parcel stays in_process."))))))))

(defn warning
  "The note to hand the model with this call's result, or nil."
  [entries name args]
  (when-not (resets-window? {:kind :call :name name :args args})
    (let [n (prior-repeats entries name args)]
      (when (>= n max-repeats)
        (str "REPEAT: you have now made this exact " name " call " (inc n)
             " times since your last edit, commit or compaction. Nothing it reads has changed,"
             " so its output is the same as before. Do not make this call again."
             " Take the next step your plan names: an edit, a commit, the handoff, or done_with_current.sh."
             (when-let [step (latest-next-step entries)]
               (str " Your last summary named this next step: "
                    (subs step 0 (min 600 (count step))))))))))

(def cycle-min-run
  "Calls in a row, each a repeat of one already made in the window, before
   the seat is told it is going round a cycle."
  6)

(defn repeat-run
  "How many keys in a row, ending with the last, each repeat a key that
   comes earlier in `keys`."
  [keys]
  (loop [i (dec (count keys)) run 0]
    (if (and (>= i 0) (some #(= (nth keys i) %) (subvec keys 0 i)))
      (recur (dec i) (inc run))
      run)))

(defn cycle-note
  "The per-call REPEAT note did not stop the iq3 coder on 2026-10-05: it went
   round four greps (one helper name, four files that do not define it) three
   times, each call warned, for no edit. A run of repeats is a cycle, and
   this names it."
  [entries name args]
  (when-not (resets-window? {:kind :call :name name :args args})
    (let [k (call-key name args)
          entries (without-in-flight (vec entries) k)
          window (->> (rseq entries)
                      (take-while (complement resets-window?))
                      reverse
                      (filter #(= :call (:kind %)))
                      (mapv #(call-key (:name %) (:args %))))
          keys (conj window k)
          run (repeat-run keys)]
      (when (>= run cycle-min-run)
        (str "LOOP: your last " run " calls each repeat a call you already made since your last edit:"
             " you are going round a cycle of " (count (distinct (take-last run keys))) " calls."
             " Running them again cannot show you anything new. Stop searching:"
             " make the edit your ticket needs now with what you already have, then run its test.")))))

(defn undo-note
  "Edits reset the repeat window, so an edit that undoes an earlier one is
   never a repeat: on 2026-10-05 the iq3 coder, on BL-1987, added and
   removed one closing paren on the same line fifteen times in five minutes
   while the edit hook named the same reader error after every edit."
  [entries name args]
  (when (and (= name "edit") (map? args))
    (let [{:strs [file_path old_string new_string]} args
          pair (fn [e] [(get (:args e) "old_string") (get (:args e) "new_string")])
          prior (->> (without-in-flight (vec entries) (call-key name args))
                     (filter #(and (= :call (:kind %)) (= "edit" (:name %))
                                   (= file_path (get (:args %) "file_path")))))
          reversed (count (filter #(= [new_string old_string] (pair %)) prior))
          same (count (filter #(= [old_string new_string] (pair %)) prior))]
      (when (pos? reversed)
        (str "UNDO: this edit puts back what an earlier edit of this file replaced"
             " (you have now flipped these lines " (+ reversed same 1) " times)."
             " Neither version is the fix. Before you edit this file again, find where it is"
             " really wrong: read the error your last edit's result names, or run the file or its test.")))))

(defn- command-base
  "A shell command without the filters piped after it: the part before the
   first `|` that is not `||`, trimmed."
  [cmd]
  (str/trim (first (str/split (str cmd) #"(?<!\|)\|(?!\|)"))))

(defn rerun-hint
  "On 2026-10-05 the iq3 coder, reviewing BL-1990, ran one feature four
   times and a 90-second test twice, each time only to filter the same
   output another way (`| tail -3`, `| grep passed`, `| tail -12`)."
  [entries name args]
  (let [cmd (when (map? args) (get args "command"))]
    (when (and (= name "run_shell_command") (string? cmd) (str/includes? cmd "|")
               (not (resets-window? {:kind :call :name name :args args})))
      (let [base (command-base cmd)
            k (call-key name args)
            window (->> (rseq (without-in-flight (vec entries) k))
                        (take-while (complement resets-window?))
                        (filter #(and (= :call (:kind %)) (= "run_shell_command" (:name %)))))]
        (when (and (not (str/blank? base))
                   (some #(let [c (str (get (:args %) "command"))]
                            (and (not= c cmd) (= base (command-base c))))
                         window))
          (str "You already ran `" base "` with another filter, and its output has not changed."
               " Next time run it once as `" base " > tmp/out.txt 2>&1`, then read or grep tmp/out.txt."))))))

(defn ready-for-next-stop-hint
  "When ready_for_next.sh reprints the in-process STOP banner, name the
   next tool call explicitly. The iq3 QA seat treated the STOP text itself
   as a cue to emit ready_for_next.sh again (coder-stop_banner_compliance);
   pointing at Read of inbox/in_process breaks that loop without a PreToolUse
   deny (denies made iq3 re-send until qwen's dialog halted the turn)."
  [name args response]
  (let [cmd (when (map? args) (get args "command"))
        text (->> (tree-seq coll? seq response) (filter string?) (str/join "\n"))]
    (when (and (= name "run_shell_command") (string? cmd)
               (re-find #"ready_for_next\.sh\b" cmd)
               (re-find #"Do NOT run ready_for_next\.sh again" text))
      (str "STOP means continue the parcel you already hold - do not run ready_for_next.sh again. "
           "Next tool: Read `.swarmforge/handoffs/inbox/in_process/` (or the TASK path just printed) "
           "and execute that parcel. ready_for_next.sh is only for when in_process is empty."))))

(defn empty-grep-hint
  "A grep that prints nothing gives a model nothing to stop on: the cycle
   above was four greps whose output was (empty) every time."
  [name args response]
  (let [cmd (when (map? args) (get args "command"))]
    (when (and (= name "run_shell_command") (string? cmd)
               (re-find #"(^|[\s|;&(])grep\s" cmd)
               (some #(re-find #"(?m)^Output: \(empty\)" %)
                     (filter string? (tree-seq coll? seq response))))
      (let [base (command-base cmd)]
        (if (or (= base (str/trim cmd)) (re-find #"^(git ls-files|ls|find|cat)\b" base))
          "grep found nothing: what it searched for is not in those files. Do not search them for it again; use what an earlier search found, or write the code."
          ;; 2026-10-05: `node .../cli.js <feature> | grep '^# (tests|pass|fail)'`
          ;; printed nothing because the run ended with no summary; "not in
          ;; those files" read as if the feature had no tests.
          (str "grep found nothing in the output of `" base "`: that command may not have printed"
               " what you expected at all. Run it once as `" base " > tmp/out.txt 2>&1` and read the end of tmp/out.txt."))))))

(defn offset-hint
  "read_file's offset counts from 0, so offset 1 starts at line 2. A model
   asking for offset 1 almost always wanted line 1: on 2026-10-05 the iq3
   coder read one file at offset 1 seven times, shrinking the limit each
   time, never saw line 1, and qwen's loop check halted it."
  [name args]
  (let [o (when (map? args) (get args "offset"))]
    (when (and (= name "read_file") (number? o) (== o 1))
      "read_file's offset counts from 0: offset 1 starts at line 2. For line 1, use offset 0.")))

(defn sleep-hint
  "A shell command that sleeps is a seat waiting on a command it put in the
   background: on 2026-10-05 the iq3 coder backgrounded the whole property
   lane three times and polled it with sleep 90 .. sleep 300 for 35 minutes."
  [name args]
  (let [cmd (when (map? args) (get args "command"))]
    (when (and (= name "run_shell_command") (string? cmd)
               (re-find #"(^|[;&|]\s*)sleep\s+\d" cmd))
      "Do not sleep to wait for a command: run it in the foreground (add `timeout <seconds>` if it can hang) and read what it prints.")))

(def big-file-lines
  "A read of more lines than this without a limit is a whole-file read."
  300)

(defn- read-path [args]
  (when (map? args)
    (let [p (or (get args "file_path") (get args "absolute_path"))]
      (when (and (string? p) (not (str/blank? p))) p))))

(defn read-hint
  "A local seat fills its window with tool output: on 2026-10-05 the iq3
   coder's session made 163 read_file calls totalling 903k characters,
   re-read one 25k-character file whole four times, and compacted every 3-5
   minutes. It also read 11 paths it had guessed and that did not exist.
   Warn-only, like every note here."
  [name args]
  (when (= name "read_file")
    (when-let [p (read-path args)]
      (let [f (java.io.File. ^String p)]
        (if-not (.exists f)
          (str "That path does not exist. Find a file before reading it: run `git ls-files | grep "
               (.getName f) "` instead of guessing a path.")
          (let [limit (get args "limit")
                lines (try (count (str/split-lines (slurp f))) (catch Exception _ 0))]
            (when (and (> lines big-file-lines)
                       (not (and (number? limit) (<= limit big-file-lines))))
              (str "That file has " lines " lines, and a whole read fills your window fast."
                   " Next time grep -n for the name you need, then read_file with offset and limit (about 100 lines)."))))))))

(def read-commands
  "Shell commands that only read the paths they name."
  #{"ls" "cat" "head" "tail" "wc" "grep" "find" "stat"})

(defn missing-shell-path
  "The first path a read-only shell command names that does not exist under
   dir, or nil. Quoted text (grep patterns), options, globs, URLs and
   redirect targets are never read as paths. On 2026-10-05 the iq3 coder
   grepped and listed specs/pipeline/features/, which does not exist (the
   features live in specs/features/), then repeated the same grep over
   specs/pipeline/ until the repeat note fired."
  [cmd dir]
  (let [unquoted (-> cmd (str/replace #"'[^']*'" " ") (str/replace #"\"[^\"]*\"" " "))]
    (some (fn [segment]
            (let [words (remove str/blank? (str/split (str/trim segment) #"\s+"))]
              (when (contains? read-commands (first words))
                (some (fn [w]
                        (when (and (re-matches #"[A-Za-z0-9._][A-Za-z0-9._/-]*/[A-Za-z0-9._/-]*" w)
                                   (not (.exists (java.io.File. ^String dir ^String w))))
                          w))
                      (rest words)))))
          (str/split unquoted #"&&|\|\||;|\||>"))))

(defn shell-path-hint
  [name args cwd]
  (let [cmd (when (map? args) (get args "command"))]
    (when (and (= name "run_shell_command") (string? cmd) (string? cwd))
      (when-let [p (missing-shell-path cmd cwd)]
        (str "`" p "` does not exist here. Find files with `git ls-files | grep <name>` instead of guessing a directory"
             " (features live in specs/features/, step handlers in specs/pipeline/steps/).")))))

(defn npm-hint
  "npm runs from extension/: the repo root has no package.json."
  [name args]
  (let [cmd (when (map? args) (get args "command"))]
    (when (and (= name "run_shell_command") (string? cmd) (re-find #"^\s*npm\s" cmd))
      "npm runs from extension/, never the repo root: use `cd extension && npm ...`.")))

(defn- notes-response [event entries name args cwd]
  (let [repeat-note (when entries (warning entries name args))
        loop-note (when entries (cycle-note entries name args))
        undo (when entries (undo-note entries name args))
        rerun (when entries (rerun-hint entries name args))
        read-budget (when entries (read-budget-note entries name args))
        notes (remove nil? [repeat-note loop-note undo rerun read-budget
                            (ready-for-next-stop-hint name args (get event "tool_response"))
                            (empty-grep-hint name args (get event "tool_response"))
                            (offset-hint name args) (sleep-hint name args)
                            (read-hint name args) (npm-hint name args)
                            (shell-path-hint name args cwd)])]
    (when (seq notes)
      (json/generate-string {"hookSpecificOutput" {"hookEventName" "PostToolUse"
                                                   "additionalContext" (str/join " " notes)}}))))

(defn answer
  ([event read-lines] (answer event read-lines end-qwen-process! release-parcel!))
  ([event read-lines kill-fn] (answer event read-lines kill-fn release-parcel!))
  ([event read-lines kill-fn release-fn]
   (let [name (get event "tool_name")
         args (get event "tool_input")
         path (get event "transcript_path")
         cwd (or (get event "cwd") (System/getProperty "user.dir"))
         ;; BL-1991/BL-1992: restart and release state/side effects are
         ;; real and consequential - unlike the notes below, they must
         ;; NEVER fall back to this process's own working directory. Only
         ;; a cwd the event itself names (as every real qwen PostToolUse
         ;; event does) can be a seat's actual worktree; anything else
         ;; leaves both restart and release inert.
         restart-cwd (get event "cwd")]
     (when (string? name)
       (let [entries (when (string? path)
                       (when-let [lines (try (read-lines path) (catch Exception _ nil))]
                         (transcript-entries lines)))
             state-file (when (and entries (string? restart-cwd)) (restart-state-file restart-cwd))
             restart-count (read-restart-count state-file)
             ;; BL-2064: a read-budget overrun joins restart/release as a
             ;; third reason, never ahead of a missed write's own (the
             ;; ticket's own direction: "restart and release keep their
             ;; precedence, the read-budget restart joins them").
             restart (when state-file (restart-decision entries name args restart-cwd restart-count))
             read-restart (when (and state-file (not restart))
                            (read-budget-restart-decision entries name args restart-count))
             release (when (and state-file (not restart) (not read-restart))
                       (release-decision entries name args restart-cwd restart-count))
             read-release (when (and state-file (not restart) (not read-restart) (not release))
                            (read-budget-release-decision entries name args restart-count))]
         (cond
           restart
           (do
             (write-restart-request! state-file (:next-step restart) (:path restart) restart-cwd restart-count)
             (kill-fn)
             nil)

           read-restart
           (do
             (write-read-budget-restart-request! state-file (:step read-restart) (:reads read-restart) restart-count)
             (kill-fn)
             nil)

           release
           (do
             (release-fn restart-cwd)
             nil)

           read-release
           (do
             (release-fn restart-cwd)
             nil)

           :else
           (notes-response event entries name args cwd)))))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [event (try (json/parse-string (slurp *in*)) (catch Exception _ nil))]
    (when-let [out (and (map? event)
                        (answer event #(str/split-lines (slurp %))))]
      (println out))))
