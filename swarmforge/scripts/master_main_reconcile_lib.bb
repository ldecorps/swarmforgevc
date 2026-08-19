;; BL-891: after QA lands an approved commit by pushing origin/main, nothing
;; ever advances the LOCAL `main` ref that the master checkout (coordinator +
;; specifier) actually reads - see this ticket's own notes for the incident
;; (a specifier scope decision written against a 20-minutes-stale local
;; `main`, corrected only by luck). push_sweep_lib.bb (BL-356) already solved
;; the mirror-image problem (local commits never reaching origin); this lib
;; is the pure decision/state logic for the opposite direction (origin's
;; landed commits never reaching local `main`) - own small copy, not required
;; from push_sweep_lib.bb, per this project's established small-duplication-
;; over-cross-file-coupling convention (see push_sweep_lib.bb's own header
;; comment).
;;
;; Deliberately NO push-retry-style bounded backoff/alarm state machine here:
;; unlike a flaky network push, reconciling a clean tree is a single local
;; git op with no transient-failure mode worth retrying on a backoff curve -
;; the only two outcomes are "reconciled" or "blocked" (dirty tree / merge
;; conflict), and a blocked tick stays blocked until something ELSE (a human,
;; or the next landing) changes the picture. State here exists ONLY to avoid
;; re-sending the identical surfaced note every single poll cycle while a
;; block persists - cleared, and free to surface again, the moment the
;; blocking REASON changes (same self-healing shape push_sweep_lib.bb's own
;; sweep! uses for its alarm flags).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "master_main_reconcile_lib.bb")))
;; and referred to as master-main-reconcile-lib/foo.
(ns master-main-reconcile-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.set :as set]
            [clojure.string :as str]))

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

;; ── durable state (daemon-dir-scoped, mirrors push_sweep_lib.bb's own
;;    state-file posture) ──────────────────────────────────────────────────

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "master-main-reconcile-state.json")))

(defn read-state [daemon-dir]
  (or (read-json (state-path daemon-dir)) {}))

(defn write-state! [daemon-dir state]
  (spit (state-path daemon-dir) (json/generate-string state)))

;; ── BL-919: parse `git status --porcelain` output into a bare set of
;;    relative paths - pure text handling so it is unit-testable without a
;;    real git process. Each line is 2 status chars + a space + the path (a
;;    leading space is normal for e.g. worktree-only changes, " M path");
;;    a rename ("R  old -> new") reports BOTH sides, because either one
;;    landing in the incoming merge's own changed-paths set is a real
;;    conflict risk. Minimal - no quote-unescaping for paths with unusual
;;    characters, matching this ticket's own "if computing the overlap is
;;    ever uncertain, refusing is the safe answer" (an unparsed exotic path
;;    still shows up as SOME string, which just makes overlap detection
;;    conservative, never silently blind). ───────────────────────────────
(defn porcelain-lines->paths
  [porcelain-text]
  (into #{}
        (mapcat (fn [line]
                  (when (>= (count line) 4)
                    (let [rest-of-line (subs line 3)]
                      (if (str/includes? rest-of-line " -> ")
                        (str/split rest-of-line #" -> " 2)
                        [rest-of-line])))))
        (str/split-lines (or porcelain-text ""))))

;; ── pure: does any dirty path collide with a path the incoming merge would
;;    itself write to? This is exactly the condition under which a plain
;;    `git merge` refuses (uncommitted local changes / an untracked file it
;;    would otherwise overwrite) - anything else, git's own 3-way merge
;;    leaves the untouched dirty path exactly as it found it (BL-919's own
;;    existence proof: the human's by-hand `git merge --no-edit origin/main`
;;    against a dirty-but-non-overlapping tree succeeded, dirty files
;;    untouched). ─────────────────────────────────────────────────────────
(defn overlapping-paths
  [dirty-paths merge-changed-paths]
  (set/intersection (set dirty-paths) (set merge-changed-paths)))

;; ── sentinel for "the dirty-path check itself could not run" (e.g. `git
;;    status` failed) - never a real path, so it can never overlap a real
;;    merge-changed path by accident. reconcile-decision special-cases its
;;    presence to force a block regardless of overlap: this ticket's own
;;    directive is "if computing the overlap is ever uncertain, refusing is
;;    the safe answer, because refusing is what happens today." ──────────
(def unknown-dirty-marker ::unknown-dirty-state)

;; ── pure: what should this sweep do, given local main's ahead/behind counts
;;    against origin/main, which paths are dirty in the master checkout's
;;    working tree, and which paths the incoming merge would itself change?
;;    `behind` zero means origin has nothing local doesn't already have - up
;;    to date regardless of ahead (this sweep only ever merges origin
;;    FORWARD into local, it never pushes - that direction is already
;;    push_sweep_lib.bb's job).
;;
;;    BL-919 narrows the old blanket "(not clean?) -> :dirty-blocked" gate:
;;    a dirty tree only blocks reconciliation when a dirty path actually
;;    OVERLAPS a path the incoming merge would change (including an
;;    untracked file sitting where the merge would create one) - a dirty
;;    tree with zero overlap now reconciles exactly like a clean one, since
;;    that is precisely the state git itself would happily merge. This is a
;;    strict widening only: every input that used to reach :should-reconcile
;;    (dirty-paths empty) still does, because an empty set overlaps nothing.
(defn reconcile-decision
  [{:keys [behind dirty-paths merge-changed-paths]}]
  (let [behind (or behind 0)
        dirty-paths (or dirty-paths #{})
        merge-changed-paths (or merge-changed-paths #{})]
    (cond
      (zero? behind) :up-to-date
      (contains? dirty-paths unknown-dirty-marker) :dirty-blocked
      ;; A merge-changed-paths computation that itself failed is only
      ;; dangerous when there is real dirt to protect - an actually-clean
      ;; tree has nothing that could overlap, uncertain or not, so it still
      ;; reconciles (invariant 3: never regress a state the old gate let
      ;; through).
      (and (seq dirty-paths) (contains? merge-changed-paths unknown-dirty-marker)) :dirty-blocked
      (seq (overlapping-paths dirty-paths merge-changed-paths)) :dirty-blocked
      :else :should-reconcile)))

;; ── observable drift report (scenario 04: "the drift check runs" and
;;    reports both counts) - trivial, but gives the ahead/behind numbers
;;    their own directly-testable unit distinct from the full sweep. ───────
(defn drift-report
  [{:keys [ahead behind]}]
  {:ahead (or ahead 0) :behind (or behind 0)})

;; ── surfaced-note message + draft (≤80 chars, per handoff-protocol.md's
;;    `note` message field limit) - reused by both blocked outcomes so the
;;    coordinator gets ONE recognizable shape regardless of which reason
;;    fired. BL-919's own qa_e2e_procedure asks the block to name the
;;    offending paths, not just say "dirty tree" - a single short path names
;;    itself, more than one collapses to a count, and if naming the path
;;    would blow the 80-char budget the message falls back to the unnamed
;;    form rather than truncating a path into something misleading. ────────
(defn surface-message
  [{:keys [behind reason overlapping-paths]}]
  (case reason
    :dirty
    (let [paths (vec (or overlapping-paths []))
          base (str "BL-891: master main " behind " behind origin, dirty overlap")
          suffix " - not reconciled"
          detail (case (count paths)
                   0 ""
                   1 (str ": " (first paths))
                   (str ": " (count paths) " paths"))
          named (str base detail suffix)]
      (if (<= (count named) 80) named (str base suffix)))
    :conflict (str "BL-891: master main reconcile hit a merge conflict, aborted, " behind " behind")))

(defn surface-draft-lines
  "A `note` to the coordinator only - reconciling the master checkout's own
   `main` ref is not a role's judgement call, it is the surfaced FACT that
   this sweep could not act; the coordinator is the constitution's own
   'unblock stalls' role (Article 1.1)."
  [msg]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " msg)])

;; ── BL-920: persistent-block operator escalation ────────────────────────
;; The coordinator note above fires once per episode and then goes quiet
;; (deliberately, so a standing block does not spam every tick) - but
;; nothing ever escalates past that single note, so a block that outlives
;; the note is silently indistinguishable from one that resolved a minute
;; later. This section adds a SECOND, independent per-episode counter: how
;; many consecutive ticks has the SAME reason persisted, and has the
;; operator already been escalated to for this episode.

(def escalation-default-threshold
  "BL-920 approval_context: the human intake left this number unnamed
   ('still persists across ticks') and asked the implementer to pick a
   defensible default rather than invent one in the spec. 3 mirrors
   chase-sweep-lib/open-slot-escalation-default-threshold's own default for
   the identical 'bounded-count-then-alert-once' shape (BL-798) - this
   project's existing precedent for how many unacted ticks earn an operator
   escalation. Amendable via swarmforge.conf."
  3)

(defn parse-escalation-threshold
  "Pure: `config master_main_reconcile_escalation_threshold <n>` from conf
   text. Honors a POSITIVE integer only - absent, malformed, zero, and
   negative all degrade to the default, mirroring chase-sweep-lib/parse-
   open-slot-escalation-threshold's own degrade-to-default failure mode."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config master_main_reconcile_escalation_threshold"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n escalation-default-threshold)))

(defn next-block-state
  "Advance the persisted per-episode block state for one blocked tick with
   `reason` (\"dirty\" or \"conflict\"). A reason that differs from the
   PREVIOUS tick's (including no previous tick at all) starts a fresh
   episode - ticks reset to 1, escalated cleared - so a later, unrelated
   block is judged on its own merits rather than inheriting a prior
   episode's count (invariant 2). The SAME reason persisting increments the
   tick count and otherwise carries the state (including a true :escalated)
   forward unchanged."
  [state reason]
  (if (= (:surfaced state) reason)
    (update state :ticks (fnil inc 0))
    {:surfaced reason :ticks 1 :escalated false}))

(defn escalation-due?
  "Pure predicate: has this (already-advanced) block state crossed the
   escalation threshold, and has this episode not already escalated? Once
   true and acted on, the caller is responsible for persisting :escalated
   true so a later tick of the SAME episode never re-fires (invariant 1:
   escalation is a second signal added once, not repeated every tick)."
  [state threshold]
  (and (>= (:ticks state 0) threshold) (not (:escalated state))))

(defn escalation-reason
  "Standing evidence text for the escalation email body / log - same role
   as chase-sweep-lib/open-slot-escalation-reason."
  [reason behind ticks]
  (str "BL-920: master-main-reconcile has been " (name reason) "-blocked for "
       ticks " consecutive sweep ticks (local main " behind
       " behind origin/main) with no coordinator action able to resolve it. "
       "The coordinator's first-tick note has already fired; this is the "
       "escalation past that, because the block has persisted. A human "
       "needs to look at the master checkout directly."))

(defn escalation-telegram-text
  "Standing Operator-topic text (telegram-reply-outbox.jsonl threadId
   OPERATOR) - same role as chase-sweep-lib/open-slot-escalation-telegram-text."
  [reason behind ticks]
  (str "⚠️ master main reconcile still " (name reason) "-blocked after "
       ticks " ticks, " behind " behind origin - needs a human."))

(defn escalation-email-subject
  [reason]
  (str "SwarmForge: master main reconcile stuck (" (name reason) ")"))

;; ── adapter-injected orchestration ───────────────────────────────────────
;; adapters: {:rev-counts!          (fn [] -> {:ahead int :behind int}) -
;;                                   already fetches origin/main as a side
;;                                   effect, same posture as
;;                                   push_sweep_lib.bb's own :rev-counts!
;;           :dirty-paths!          (fn [] -> coll of path strings) - which
;;                                   paths are dirty (modified/staged/
;;                                   untracked) in the master checkout's
;;                                   working tree right now?
;;           :merge-changed-paths!  (fn [] -> coll of path strings) - which
;;                                   paths would the incoming merge (origin/
;;                                   main against the merge-base) itself
;;                                   write to? Only ever called when
;;                                   behind>0 - nothing to diff against
;;                                   otherwise.
;;           :merge!                (fn [] -> {:success bool :error str?}) -
;;                                   the SOLE state-mutating call this lib
;;                                   ever makes. Called ONLY when
;;                                   reconcile-decision says
;;                                   :should-reconcile (behind>0 AND no
;;                                   dirty/merge-changed path overlap). Must
;;                                   never be a reset/rebase/stash/force-
;;                                   update - that is the caller's
;;                                   (handoffd.bb's) contract, not something
;;                                   this pure lib can enforce by itself, but
;;                                   it is also the ONLY mutating adapter
;;                                   offered, so there is nowhere else for
;;                                   one to hide.
;;           :surface!              (fn [msg] -> nil) - sends the surfaced
;;                                   note
;;           :escalate!             (fn [{:keys [reason behind ticks]}] -> nil) -
;;                                   BL-920: fires ONCE per episode, only
;;                                   after the SAME block reason has
;;                                   persisted `threshold` consecutive ticks
;;                                   and this episode has not already
;;                                   escalated - the operator-facing
;;                                   escalation, additive to (never instead
;;                                   of) the coordinator note :surface!
;;                                   already sent on this episode's first
;;                                   tick.
;;           :log!                  (fn [& parts])}
;;
;; Self-healing across transitions, mirroring push_sweep_lib.bb's own
;; sweep!: reaching :up-to-date or a successful :should-reconcile always
;; clears persisted state (surfaced reason, tick count, AND escalated flag),
;; so a LATER, unrelated block always surfaces - and, on its own schedule,
;; escalates - fresh rather than being silently suppressed by a stale flag
;; from a resolved episode (BL-920 invariant 2).
(defn sweep!
  [daemon-dir threshold adapters]
  (let [state (read-state daemon-dir)
        counts ((:rev-counts! adapters))
        {:keys [ahead behind]} (drift-report counts)]
    ((:log! adapters) "master-main-reconcile" "drift" (str "ahead=" ahead " behind=" behind))
    (let [dirty-paths (set ((:dirty-paths! adapters)))
          merge-changed-paths (if (pos? behind) (set ((:merge-changed-paths! adapters))) #{})
          decision (reconcile-decision {:behind behind
                                         :dirty-paths dirty-paths
                                         :merge-changed-paths merge-changed-paths})
          ;; BL-920: shared by both blocked branches below - the first tick
          ;; of a (possibly new) episode still gets exactly the SAME
          ;; coordinator note as before (invariant 1's "additive, never
          ;; instead of"); escalation is a SEPARATE decision layered on top,
          ;; keyed off the advanced tick count.
          handle-blocked!
          (fn [reason surface-msg]
            (let [first-tick? (not= (:surfaced state) reason)
                  next-state (next-block-state state reason)]
              (when first-tick?
                ((:surface! adapters) surface-msg))
              (if (escalation-due? next-state threshold)
                (do
                  ((:escalate! adapters) {:reason reason :behind behind :ticks (:ticks next-state)})
                  (write-state! daemon-dir (assoc next-state :escalated true)))
                (write-state! daemon-dir next-state))))]
      (case decision
        :up-to-date
        (do
          ((:log! adapters) "master-main-reconcile" "up-to-date")
          (when (seq state) (write-state! daemon-dir {})))

        :dirty-blocked
        (do
          ((:log! adapters) "master-main-reconcile" "dirty-blocked")
          (handle-blocked! "dirty" (surface-message {:behind behind :reason :dirty
                                                       :overlapping-paths (overlapping-paths dirty-paths merge-changed-paths)})))

        :should-reconcile
        (let [result ((:merge! adapters))]
          (if (:success result)
            (do
              ((:log! adapters) "master-main-reconcile" "reconciled")
              (write-state! daemon-dir {}))
            (do
              ((:log! adapters) "master-main-reconcile" "conflict" (str (:error result)))
              (handle-blocked! "conflict" (surface-message {:behind behind :reason :conflict})))))))))
