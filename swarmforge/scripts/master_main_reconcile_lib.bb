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

;; BL-1120: never abort a merge this tick did not start.
(defn may-abort-failed-merge?
  "True only when this tick started the merge attempt (MERGE_HEAD was absent
   before git merge). A pre-existing MERGE_HEAD is a foreign merge — never abort."
  [started-this-tick?]
  (boolean started-this-tick?))

(defn merge-attempt-plan
  "Given whether MERGE_HEAD already exists: :skip-human-merge-in-progress or :run-merge."
  [merge-head-already-present?]
  (if merge-head-already-present?
    :skip-human-merge-in-progress
    :run-merge))

;; BL-1130: automated absorb never leaves mid-merge for an external editor.
(defn tip-contains-origin?
  "True when origin/main is already an ancestor of HEAD — absorb is FF/noop."
  [origin-is-ancestor-of-head?]
  (boolean origin-is-ancestor-of-head?))

(defn automated-absorb-plan
  "Plan for the automated origin/main absorb path.
   :noop | :skip-human-merge-in-progress | :refuse-rematch | :run-merge.
   Never starts a merge known to conflict (no MERGE_HEAD left for an editor)."
  [{:keys [merge-head-present? behind would-conflict? tip-contains-origin?]}]
  (cond
    merge-head-present? :skip-human-merge-in-progress
    (or (zero? (or behind 0)) tip-contains-origin?) :noop
    would-conflict? :refuse-rematch
    :else :run-merge))

(defn post-absorb-clean?
  "Invariant 1: after automated absorb, no MERGE_HEAD and no unmerged paths."
  [merge-head-present? unmerged-path-count]
  (and (not merge-head-present?) (zero? (or unmerged-path-count 0))))

(defn absorb-outcome-names-rematch-or-refuse?
  "Invariant 2: refuse vocabulary — rematch/refuse, never editor recovery."
  [outcome-or-message]
  (let [s (str outcome-or-message)]
    (and (or (str/includes? s "rematch") (str/includes? s "refuse"))
         (not (re-find #"(?i)finish this merge in an editor|resolve.*(in|with).*editor" s)))))

;; BL-1236: the predicate this replaces (`merge-tree-reports-conflict?`)
;; case-insensitively grepped the CONTENT of the legacy three-argument
;; `git merge-tree`'s unified-diff output for words like "CONFLICT" - so
;; any merged file whose own text happened to contain that word (this
;; repo's ticket/evidence prose does, constantly) read as a predicted
;; conflict. Ten resets discarded committed work this way, one destroying
;; a human's approval tap. `git merge-tree --write-tree <a> <b>` (git
;; >= 2.38) gives an actual machine-readable VERDICT instead: exit 0 is a
;; clean merge, exit 1 is a genuine conflict, anything else means the
;; simulation itself could not run - never a diff to read. Mirrors the
;; in-repo precedent, tree_collapse_guard_lib.bb:73-80, which already keys
;; on exit alone for exactly this reason ("never a diff-based guess").
(defn merge-verdict
  "Classify a `git merge-tree --write-tree <a> <b>` invocation's exit code
   into git's own verdict for the merge: :clean, :conflict, or
   :unavailable (the simulation itself could not run - a git failure,
   never treated as \"conflict\"). An unavailable verdict must never
   authorise a reset (BL-1236 invariant 3) - callers dispatch it to its
   own non-destructive plan branch, same as merge-head-present? or a
   dirty-path overlap."
  [exit-code]
  (case (int (or exit-code -1))
    0 :clean
    1 :conflict
    :unavailable))

;; BL-1131: rematch-then-FF land — behind=0 without operator absorb merge.
(defn prepublish-rematch-plan
  "Before publish: tip must contain origin/main.
   :already-contains-origin | :rematch-clean | :refuse-lander"
  [{:keys [tip-contains-origin? rematch-would-conflict?]}]
  (cond
    tip-contains-origin? :already-contains-origin
    rematch-would-conflict? :refuse-lander
    :else :rematch-clean))

(defn post-land-absorb-plan
  "After a rematch-prepared tip lands on origin/main.
   :noop | :ff-absorb | :replay-bookkeeping | :refuse-rematch-lander |
   :skip-human-merge-in-progress.
   Never plans an operator content-conflict absorb merge."
  [{:keys [merge-head-present? behind ahead tip-contains-origin?
           absorb-would-conflict?]}]
  (cond
    merge-head-present? :skip-human-merge-in-progress
    (or (zero? (or behind 0)) tip-contains-origin?) :noop
    (and (pos? (or behind 0)) (zero? (or ahead 0))) :ff-absorb
    absorb-would-conflict? :replay-bookkeeping
    :else :ff-absorb))

(defn absorb-dispatch-plan
  "Single absorb decision for handoffd + post_hotfix runners.
   Prefer land noop/replay, then BL-1236 verdict-unavailable, then BL-1130
   refuse-rematch, else :ff-absorb. Never returns an operator
   content-conflict absorb.
   BL-1236: `verdict-unavailable?` (true when the merge-tree simulation
   itself could not run, distinct from a genuine reported conflict) is
   checked AFTER noop - a divergence that needs no merge at all (already
   up to date, or nothing behind) is safe regardless of what the verdict
   would have been - but BEFORE every branch that could otherwise plan an
   :ff-absorb (whose fallback is a reset) or a rematch: an unavailable
   answer must never be treated as license to attempt the merge and reset
   on failure. Callers execute :verdict-unavailable as a pure block/surface,
   same shape as :dirty-blocked - never a git write."
  [{:keys [merge-head-present? behind ahead tip-contains-origin?
           would-conflict? absorb-would-conflict? verdict-unavailable?] :as ctx}]
  (let [conflict? (or would-conflict? absorb-would-conflict?)
        bl1130 (automated-absorb-plan
                (assoc ctx :would-conflict? conflict?
                       :tip-contains-origin? tip-contains-origin?))
        land (post-land-absorb-plan
              (assoc ctx :absorb-would-conflict? conflict?))]
    (cond
      (= bl1130 :skip-human-merge-in-progress) :skip-human-merge-in-progress
      (= land :noop) :noop
      verdict-unavailable? :verdict-unavailable
      (= land :replay-bookkeeping) :replay-bookkeeping
      (= bl1130 :refuse-rematch) :refuse-rematch
      :else :ff-absorb)))

(defn designed-recovery-is-operator-absorb?
  "True only when wording pages an operator to finish a conflicted absorb."
  [outcome-or-message]
  (boolean
   (re-find #"(?i)complete origin/main merge|operator.*(absorb|finish).*merge|finish this merge in an editor"
            (str outcome-or-message))))

(defn land-pipeline-outcome
  "Compose pre-publish + post-land absorb into a single land result map.
   Successful rematch-then-FF: {:behind 0 :sync-action :proceed :ok? true
   :recovery :none :mid-merge? false}.
   Conflicted rematch/race: rematch lander/bookkeeping — never operator absorb."
  [{:keys [prepublish-plan absorb-plan mid-merge?]}]
  (let [clean? (not mid-merge?)]
    (case prepublish-plan
      :refuse-lander
      {:ok? false :behind nil :sync-action nil
       :recovery :rematch-lander :mid-merge? (boolean mid-merge?)
       :designed-recovery-operator-absorb? false}
      (case absorb-plan
        (:noop :ff-absorb)
        {:ok? true :behind 0 :sync-action :proceed :recovery :none
         :mid-merge? (boolean mid-merge?)
         :designed-recovery-operator-absorb? false}
        :replay-bookkeeping
        {:ok? false :behind nil :sync-action nil
         :recovery :rematch-bookkeeping-owner :mid-merge? (boolean mid-merge?)
         :designed-recovery-operator-absorb? false}
        :refuse-rematch-lander
        {:ok? false :behind nil :sync-action nil
         :recovery :rematch-lander :mid-merge? (boolean mid-merge?)
         :designed-recovery-operator-absorb? false}
        :skip-human-merge-in-progress
        {:ok? false :behind nil :sync-action nil
         :recovery :human-merge-in-progress :mid-merge? true
         :designed-recovery-operator-absorb? false}
        {:ok? false :behind nil :sync-action nil
         :recovery :refuse-rematch :mid-merge? (not clean?)
         :designed-recovery-operator-absorb? false}))))

(defn may-publish-land-tip?
  "Tip may publish only when prepublish plan is ready (contains origin or rematch-clean)."
  [prepublish-plan]
  (contains? #{:already-contains-origin :rematch-clean} prepublish-plan))

;; ── BL-1144: publish-time rematch + land/close publisher serialize ─────
;; Gate-time tip purity is advisory. Authoritative purity is immediately
;; before the land push. Concurrent land/close publishers take a lock edge
;; so a peer push does not spawn unbounded mid-gate tip-purity bounce loops.
;; Residual race recovery stays rematch lander/bookkeeping (BL-1130/1131) —
;; never human absorb, never force-push, never impure land.

(def publish-rematch-max-attempts
  "Initial publish-time rematch plus one residual retry (invariant: at most
   one rematch per publish attempt after the first; never unbounded)."
  2)

(defn origin-advanced-since-gate?
  "True when origin/main SHA at publish differs from the SHA recorded at
   gate start (nil either side → treat as not advanced / unknown)."
  [gate-origin-sha publish-origin-sha]
  (boolean (and gate-origin-sha publish-origin-sha
                (not= gate-origin-sha publish-origin-sha))))

(defn- rematch-attempt-exhausted? [attempt max-attempts]
  (>= (or attempt 0) (or max-attempts publish-rematch-max-attempts)))

(defn publish-time-purity-action
  "Decision immediately before land push (BL-1144 scenario 01).
   :push | :rematch-then-push | :retry-rematch | :wait-land-lock |
   :refuse-rematch-lander. Peer lock → wait (serialize) rather than bounce."
  [{:keys [tip-contains-origin-now? rematch-would-conflict?
           attempt max-attempts peer-holds-land-lock?]}]
  (cond
    peer-holds-land-lock? :wait-land-lock
    tip-contains-origin-now? :push
    rematch-would-conflict? :refuse-rematch-lander
    (rematch-attempt-exhausted? attempt max-attempts) :wait-land-lock
    (pos? (or attempt 0)) :retry-rematch
    :else :rematch-then-push))

(defn land-close-publisher-admission
  "Lock-edge admission for concurrent land/close publishers (scenario 02).
   :admit | :wait-lock | :rematch-once-at-edge. Second writer never starts a
   mid-gate unbounded rematch storm — at most one rematch at the lock edge."
  [{:keys [lock-available? already-rematched-at-edge?]}]
  (cond
    lock-available? :admit
    already-rematched-at-edge? :wait-lock
    :else :rematch-once-at-edge))

(defn contention-publish-next
  "Compose purity + lock admission into one next step. Never returns an
   unbounded-bounce action."
  [{:keys [purity-action lock-admission]}]
  (case lock-admission
    :wait-lock :wait-land-lock
    :rematch-once-at-edge :rematch-once-at-edge
    ;; :admit — purity decides
    (case purity-action
      (:push :rematch-then-push :retry-rematch :wait-land-lock :refuse-rematch-lander)
      purity-action
      :wait-land-lock)))

(defn residual-race-recovery-ok?
  "After controls, residual recovery is rematch lander/bookkeeping or none —
   never operator absorb (scenario 03 / BL-1130 posture)."
  [recovery]
  (contains? #{:none :rematch-lander :rematch-bookkeeping-owner} recovery))

(defn tip-purity-required?
  "Landed tips must remain tip-pure vs origin/main — impure lands forbidden."
  []
  true)

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
  (let [refuse-absorb (str "BL-1130: absorb refused — rematch onto origin/main, " behind " behind")
        rematch-bk (str "BL-1135: rematch bookkeeping onto origin/main, " behind " behind")]
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
      :conflict refuse-absorb
      :refuse-rematch refuse-absorb
      :rematch-bookkeeping
      (if (<= (count rematch-bk) 80) rematch-bk "BL-1135: rematch bookkeeping onto origin/main")
      :human-merge-in-progress
      (let [msg (str "BL-1120: human-merge-in-progress on master, " behind " behind - not aborted")]
        (if (<= (count msg) 80) msg "BL-1120: human-merge-in-progress on master - not aborted"))
      :verdict-unavailable
      (let [msg (str "BL-1236: merge verdict unavailable, " behind " behind origin - not reset")]
        (if (<= (count msg) 80) msg "BL-1236: merge verdict unavailable - not reset"))
      ;; BL-1288: this `case` has no default, so a reason this library can
      ;; itself produce and has no branch for does not surface a nil note -
      ;; it THROWS, inside the daemon's sweep. :push-unavailable is a reason
      ;; this library now produces, so it gets a branch here rather than
      ;; relying on which caller happens to relabel it first.
      :push-unavailable
      (let [msg (str "BL-1288: push failed, not a rejection, " behind " behind - not reset")]
        (if (<= (count msg) 80) msg "BL-1288: push failed, not a rejection - not reset")))))

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

;; ── BL-1248: config kill switch ──────────────────────────────────────────
;; Fails closed BY CONSTRUCTION, not by enumerating bad values: the ONLY
;; token that enables is the exact literal "true" as the key's sole value.
;; Absent (no matching line), empty (no third token), malformed ("banana"),
;; and even the negative-looking "false" all fall through the same single
;; `=` check to disabled - there is no separate "explicitly false" branch to
;; forget, mirroring parse-escalation-threshold's own degrade-to-default
;; shape but with "disabled" as the one and only fallback rather than a
;; degrade-to-a-default-number.
(defn parse-enabled?
  "Pure: `config master_main_reconcile_enabled <value>` from conf text.
   Only the exact value \"true\" enables the sweep - the line must tokenize
   to exactly 3 whitespace-separated tokens (`config`, the key, one value
   token); trailing garbage after the value ('true true') is malformed, not
   an affirmative, and falls through to disabled like any other malformed
   line."
  [conf-text]
  (boolean
   (when-let [line (some->> (str/split-lines (or conf-text ""))
                             (filter #(str/starts-with? % "config master_main_reconcile_enabled"))
                             first)]
     (let [tokens (str/split (str/trim line) #"\s+")]
       (and (= 3 (count tokens)) (= "true" (nth tokens 2)))))))

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

(defn merge-failure-reason
  "Map merge! outcome to persisted block reason. BL-1135: rematch outcomes
   stay distinct from conflict (Operator needs-a-human absorb paging).
   BL-1236: :verdict-unavailable stays distinct from both - it is neither
   a reported conflict nor a designed rematch recovery, so it must not be
   routed through rematch-owner-recovery?'s silent-state-only path; it
   goes through handle-blocked! like \"dirty\", surfacing a note.
   BL-1288: :push-unavailable is the same shape - the push could not be
   ATTEMPTED against the remote (transport, credentials), so there is
   nothing to absorb and nothing designed to recover; it must not be
   mislabelled \"conflict\", which both pages for an absorb merge that does
   not exist and is a durable deadlock end-state."
  [outcome]
  (case (or outcome :conflict)
    :human-merge-in-progress "human-merge-in-progress"
    :refuse-rematch "refuse-rematch"
    :rematch-bookkeeping "rematch-bookkeeping"
    :verdict-unavailable "verdict-unavailable"
    :push-unavailable "push-unavailable"
    "conflict"))

(defn rematch-owner-recovery?
  "True when the block reason is designed rematch recovery (not absorb)."
  [reason]
  (contains? #{"rematch-bookkeeping" "refuse-rematch"} (name reason)))

(defn escalation-reason
  "Standing evidence text for the escalation email body / log - same role
   as chase-sweep-lib/open-slot-escalation-reason."
  [reason behind ticks]
  (if (rematch-owner-recovery? reason)
    (str "BL-1135: master-main-reconcile " (name reason) " for " ticks
         " ticks (local main " behind " behind origin/main). Designed recovery "
         "is rematch lander/bookkeeping owner — not operator absorb merge.")
    (str "BL-920: master-main-reconcile has been " (name reason) "-blocked for "
         ticks " consecutive sweep ticks (local main " behind
         " behind origin/main) with no coordinator action able to resolve it. "
         "The coordinator's first-tick note has already fired; this is the "
         "escalation past that, because the block has persisted. A human "
         "needs to look at the master checkout directly.")))

(defn escalation-telegram-text
  "Standing Operator-topic text (telegram-reply-outbox.jsonl threadId
   OPERATOR) - same role as chase-sweep-lib/open-slot-escalation-telegram-text."
  [reason behind ticks]
  (if (rematch-owner-recovery? reason)
    (str "master main reconcile " (name reason) " after " ticks
         " ticks, " behind " behind — rematch owner (not absorb merge)")
    (str "⚠️ master main reconcile still " (name reason) "-blocked after "
         ticks " ticks, " behind " behind origin - needs a human.")))

(defn escalation-email-subject
  [reason]
  (str "SwarmForge: master main reconcile stuck (" (name reason) ")"))

;; ── main-sync status + deadlock circuit breaker (coordinator step 0) ─────
;; Gate bookkeeping on behind=0. When ahead+behind (or dirty-escalated
;; reconcile) holds an aged coordinator in_process parcel, trip once:
;; suppress wakes / dropped-parcel notes and stop burning tokens.

(defn sync-action
  "Pure. What should the coordinator do before QA bookkeeping?
   :proceed | :ff-only | :wait-reconcile | :wait-dirty-clear | :deadlock-tripped"
  [{:keys [ahead behind reconcile-surfaced reconcile-escalated deadlock-active?]}]
  (let [ahead (or ahead 0)
        behind (or behind 0)]
    (cond
      deadlock-active? :deadlock-tripped
      (zero? behind) :proceed
      (and (pos? behind) (zero? ahead)) :ff-only
      (and (pos? behind)
           (or reconcile-escalated
               (#{"dirty" "conflict"} (str reconcile-surfaced))))
      :wait-dirty-clear
      (and (pos? ahead) (pos? behind)) :wait-reconcile
      :else :wait-reconcile)))

(defn deadlock-path [daemon-dir]
  (str (fs/path daemon-dir "main-sync-deadlock.json")))

(defn read-deadlock [daemon-dir]
  (or (read-json (deadlock-path daemon-dir)) {}))

(defn write-deadlock! [daemon-dir state]
  (spit (deadlock-path daemon-dir) (json/generate-string state)))

(defn clear-deadlock! [daemon-dir]
  (write-deadlock! daemon-dir {}))

(defn deadlock-active?
  [state]
  (boolean (:active state)))

(def deadlock-default-threshold-ticks
  "Consecutive blocked-main ticks before trip. ~3 handoffd cycles."
  3)

(defn deadlock-trip-due?
  "True when behind>0, (ahead>0 or reconcile dirty/conflict escalated),
   coordinator holds aged in_process, threshold crossed, and not yet active.
   BL-1138: rematch-owner recovery must never durable-trip — rematch/replay
   is the designed path, not deadlock-tripped waiting for Cursor."
  [{:keys [ahead behind reconcile-surfaced reconcile-escalated
           coordinator-in-process-aged? blocked-ticks deadlock-state
           threshold-ticks]}]
  (let [ahead (or ahead 0)
        behind (or behind 0)
        ticks (or blocked-ticks 0)
        threshold (or threshold-ticks deadlock-default-threshold-ticks)
        rematch-recovery? (rematch-owner-recovery? (str reconcile-surfaced))
        blocked-shape?
        (and (pos? behind)
             (or (pos? ahead)
                 reconcile-escalated
                 (#{"dirty" "conflict"} (str reconcile-surfaced))))]
    (boolean
     (and blocked-shape?
          (not rematch-recovery?)
          coordinator-in-process-aged?
          (>= ticks threshold)
          (not (deadlock-active? deadlock-state))))))


(defn deadlock-clear?
  "Clear when origin is absorbed."
  [behind]
  (zero? (or behind 0)))

(defn after-successful-rematch-status
  "BL-1138: status after rematch/replay brought behind to 0."
  [{:keys [ahead behind deadlock-was-active?]}]
  (let [behind (or behind 0)
        action (sync-action {:ahead (or ahead 0) :behind behind
                             :deadlock-active? false})]
    {:behind behind
     :sync-action action
     :clear-deadlock? (boolean (or deadlock-was-active? (deadlock-clear? behind)))
     :ok? (and (zero? behind) (#{:proceed :ff-only} action))}))

(defn designed-end-state-is-deadlock-tripped?
  "BL-1138: rematch-owner reasons must not end as durable deadlock-tripped."
  [reason]
  (and (not (rematch-owner-recovery? reason))
       (#{"dirty" "conflict" "diverged"} (name (or reason "")))))

(defn deadlock-alert-subject []
  "SwarmForge: main-sync deadlock — bookkeeping halted")

(def overlap-hint-path-cap
  "Max overlapping paths named in operator/email hints before +N more."
  8)

(defn normalize-overlapping-paths
  "Drop unknown-dirty sentinel and blank entries; stable sorted vec for hints."
  [paths]
  (->> (or paths [])
       (remove #(or (= unknown-dirty-marker %) (str/blank? (str %))))
       (map str)
       sort
       vec))

(defn format-overlapping-path-list
  "Name overlapping dirty paths for operator/email (cap + remainder count)."
  [paths]
  (let [paths (normalize-overlapping-paths paths)
        n (count paths)
        shown (vec (take overlap-hint-path-cap paths))
        more (- n (count shown))]
    (cond
      (zero? n) nil
      (pos? more) (str (str/join ", " shown) " (+" more " more)")
      :else (str/join ", " shown))))

(defn format-overlapping-path-hint
  "Operator/babysitter/email fix clue: name overlaps + clear-then-./swarm heal."
  [paths]
  (let [listed (format-overlapping-path-list paths)]
    (if listed
      (str "clear these overlapping dirty paths off master main (" listed
           "), then ./swarm heal")
      (str "run git status --porcelain on master checkout; clear any dirty/"
           "untracked paths that overlap incoming origin/main; then ./swarm heal "
           "(see docs/how-to/BL-891-master-main-reconcile-sweep.md)"))))

(defn operator-deadlock-hint
  "BL-1187: babysitterd/operator/email-facing hint when main-sync-deadlock is active."
  [{:keys [ahead behind reason overlapping-paths]}]
  (str "main-sync deadlock (" (or reason "diverged") "): local main ahead="
       (or ahead 0) " behind=" (or behind 0)
       "; coordinator bookkeeping halted — operator fix: "
       (format-overlapping-path-hint overlapping-paths)
       "; handoffd auto-reconciles once overlap clears (BL-891). Not /pilot."))

(defn deadlock-alert-text
  "Trip-once Telegram/email body — same actionable clue as babysitter CRIT."
  [{:keys [ahead behind reason overlapping-paths]}]
  (str "⚠️ " (operator-deadlock-hint
              {:ahead ahead :behind behind :reason (or reason "diverged-or-dirty")
               :overlapping-paths overlapping-paths})))

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
(defn- merge-failure-log-tail
  "Log suffix for a failed merge! — reason token, plus error except for
   human-merge-in-progress (no merge error string)."
  [outcome error]
  (let [reason (merge-failure-reason outcome)]
    (cond-> [reason]
      (not= reason "human-merge-in-progress") (conj (str error)))))

(defn- handle-merge-failure!
  [daemon-dir state adapters behind handle-blocked! result]
  (let [outcome (or (:outcome result) :conflict)
        reason (merge-failure-reason outcome)
        surface-msg (surface-message {:behind behind :reason (keyword reason)})]
    (apply (:log! adapters)
           (into ["master-main-reconcile"]
                 (merge-failure-log-tail outcome (:error result))))
    (if (rematch-owner-recovery? reason)
      (let [first-tick? (not= (:surfaced state) reason)
            next-state (next-block-state state reason)]
        (when first-tick?
          ((:surface! adapters) surface-msg))
        (write-state! daemon-dir next-state))
      (handle-blocked! reason surface-msg))))

;; ── BL-1288: only a REJECTED push authorises discarding local work ────────
;; BL-1198 put a push in front of the reset, but read only :success from it,
;; so EVERY unsuccessful push was treated as the genuine-divergence signal.
;; A push also fails when the remote is unreachable, when the daemon holds no
;; credential, or when the network is down - none of which is divergence, and
;; each of which then answered a healthy local-ahead branch by destroying it
;; (seven resets on 2026-08-30 alone, one of them losing a shipped ticket's
;; prose half for a full day before anyone noticed). The adapter contract
;; already returns the push's :error; this is the function that finally reads
;; it.
;;
;; Deliberately fails CLOSED. Only stderr that positively identifies a
;; non-fast-forward rejection authorises the discard; every other string -
;; unrecognised ones included - keeps the commits. Discarding committed work
;; must rest on evidence that the remote said no, never on the mere absence
;; of a transport error this list happens to know about, because that list
;; can only ever be incomplete and its gaps would be paid for in lost work.
;;
;; A hook's `[remote rejected]` is excluded on the same principle: the remote
;; did refuse the push, but for policy, not because local main diverged, so
;; resetting onto origin/main would destroy commits the remote never had a
;; newer version of.
(defn push-rejection?
  "True only when `git push` stderr identifies a non-fast-forward rejection -
   the genuine-divergence signal a reset onto origin/main exists to answer.
   nil, empty, transport, credential and hook-policy failures are all false."
  [error]
  (let [text (str/lower-case (str (or error "")))]
    (and (str/includes? text "! [rejected]")
         (or (str/includes? text "non-fast-forward")
             (str/includes? text "fetch first")))))

;; ── BL-1198: push-before-reset ───────────────────────────────────────────
;; A reset (`git reset --hard origin/main`) is only safe to the extent that
;; nothing on the branch it discards was worth keeping - but "local main is
;; ahead and collides with origin" and "these ahead commits are disposable
;; bookkeeping" are two different facts, and none of the three call sites
;; that reset onto origin/main (handoffd.bb, swarm_heal.bb,
;; post_hotfix_merge_origin.bb) ever checked the second before acting on
;; the first. Attempting a push FIRST converts the common case (no real
;; divergence, just a race with whatever normally keeps origin caught up)
;; into a plain, loss-free fast-forward: when the push succeeds, ahead
;; becomes 0 by construction and nothing needs discarding at all. Only a
;; REJECTED push (genuine divergence - the case reset actually exists for)
;; falls through to the unchanged reset recovery. Shared here, one home,
;; rather than three independent copies (this project's own "a
;; behavior/constant mirrored by hand across sites needs one shared
;; implementation" guardrail) - each of the three call sites already
;; load-files this lib.
(defn rematch-with-push-first!
  "Orchestrates push-then-reset-if-rejected. adapters:
     :push!  (fn [] -> {:success bool :error str?}) - a single `git push
             origin main` attempt, no retry loop (bounded - this project's
             own already-wired periodic push-sweep, BL-356, is what retries
             on a backoff curve, not this one-shot pre-reset attempt).
             BL-1288: its :error is READ, and decides what happens next.
     :reset! (fn [] -> map) - the EXISTING reset-to-origin recovery,
             called only when the push was REJECTED (push-rejection?); its
             return value is passed through completely unchanged, so no
             caller-visible contract changes on the genuine-divergence path.
   Returns {:success true :outcome :pushed} when the push alone already
   resolved everything (no reset needed); reset!'s own result, verbatim, on
   a genuine rejection; and, BL-1288, {:success false :outcome
   :push-unavailable :error <the push's own error>} when the push failed for
   any reason that is not a rejection - the commits are kept and the push's
   reason travels to the caller. No retry is attempted here on purpose: the
   reconcile does nothing and says why, leaving local ahead until the BL-356
   sweep or a role pushes."
  [{:keys [push! reset!]}]
  (let [push-result (push!)]
    (cond
      (:success push-result) {:success true :outcome :pushed}
      (push-rejection? (:error push-result)) (reset!)
      :else {:success false
             :outcome :push-unavailable
             :error (:error push-result)})))

;; ── BL-1214: :ff-absorb execution tries a real merge before resetting ─────
;; `absorb-dispatch-plan` resolves a genuine two-way divergence (behind>0,
;; ahead>0, no predicted conflict) to :ff-absorb, but every executor of
;; that plan ran ONLY `git merge --ff-only --no-edit origin/main` - a
;; two-way divergence can never fast-forward, whatever its content, so
;; that merge always failed and fell straight to a reset/rematch,
;; discarding the local-only commit outright even when it would have
;; merged losslessly. Shared here (all three call sites already load-file
;; this lib) rather than three independent copies of the same ladder.
(defn absorb-with-merge!
  "Orchestrates fast-forward -> real 3-way merge -> fallback for
   :ff-absorb execution. adapters:
     :ff!       (fn [] -> {:success bool}) - the EXISTING
                `git merge --ff-only --no-edit origin/main` attempt,
                unchanged.
     :merge!    (fn [] -> {:success bool ...}) - a REAL 3-way
                `git merge --no-edit origin/main` (never --ff-only),
                attempted only when the fast-forward above failed.
     :abort!    (fn [] -> _) - `git merge --abort`, called ONLY when
                :merge! above was attempted and failed (BL-1120: this
                function only ever aborts a merge it started itself -
                never speculatively, never on the ff! path).
     :fallback! (fn [] -> map) - the EXISTING conflict-recovery path
                (rematch/reset), called only when BOTH ff! and merge!
                failed; its return value passes through completely
                unchanged, so no caller-visible contract changes on the
                genuine-conflict path (constraint: that path must keep
                behaving exactly as it does today).
   Returns {:success true :outcome :ff} when the fast-forward alone
   already resolved everything (unchanged from before this ticket);
   {:success true :outcome :merged} when the 3-way merge absorbed a
   non-conflicting divergence losslessly (the new case this ticket
   adds); else fallback!'s own result, verbatim."
  [{:keys [ff! merge! abort! fallback!]}]
  (let [ff-result (ff!)]
    (if (:success ff-result)
      {:success true :outcome :ff}
      (let [merge-result (merge!)]
        (if (:success merge-result)
          {:success true :outcome :merged}
          (do (abort!)
              (fallback!)))))))

;; Self-healing across transitions, mirroring push_sweep_lib.bb's own
;; sweep!: reaching :up-to-date or a successful :should-reconcile always
;; clears persisted state (surfaced reason, tick count, AND escalated flag),
;; so a LATER, unrelated block always surfaces - and, on its own schedule,
;; escalates - fresh rather than being silently suppressed by a stale flag
;; from a resolved episode (BL-920 invariant 2).
;; BL-1248: `enabled?` is an optional 4th arg, defaulting to true, so every
;; PRE-EXISTING 3-arg call site (this lib's own extensive unit/property
;; suites, none of which own the kill switch) keeps behaving exactly as
;; before with zero edits - only handoffd.bb's own call site, and this
;; ticket's own new tests, need to reach the 4-arg form.
(defn sweep!
  ([daemon-dir threshold adapters] (sweep! daemon-dir threshold true adapters))
  ([daemon-dir threshold enabled? adapters]
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
        (if-not enabled?
          ;; BL-1248: the ONLY branch this switch guards - the sole
          ;; state-mutating adapter (:merge!) is never invoked while off.
          ;; Everything above (drift log, dirty-paths/merge-changed-paths
          ;; computation, :up-to-date and :dirty-blocked's own :surface!/
          ;; :escalate! divergence-notification paths) already ran
          ;; unconditionally above this branch and stays that way - the
          ;; switch governs the reconcile action only, never the
          ;; surfacing/escalation paths that tell a human main and origin
          ;; have diverged (this ticket's own firm constraint).
          ((:log! adapters) "master-main-reconcile" "skipped-by-config")
          (let [result ((:merge! adapters))]
            (if (:success result)
              (do
                ((:log! adapters) "master-main-reconcile" "reconciled")
                (write-state! daemon-dir {}))
              (handle-merge-failure! daemon-dir state adapters behind handle-blocked! result)))))))))
