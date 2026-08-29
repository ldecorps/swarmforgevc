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

(defn merge-tree-reports-conflict?
  "True when `git merge-tree` output names a content/add conflict."
  [merge-tree-out]
  (boolean (re-find #"(?i)changed in both|CONFLICT|added in both" (or merge-tree-out ""))))

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
   Prefer land noop/replay, then BL-1130 refuse-rematch, else :ff-absorb.
   Never returns an operator content-conflict absorb."
  [{:keys [merge-head-present? behind ahead tip-contains-origin?
           would-conflict? absorb-would-conflict?] :as ctx}]
  (let [conflict? (or would-conflict? absorb-would-conflict?)
        bl1130 (automated-absorb-plan
                (assoc ctx :would-conflict? conflict?
                       :tip-contains-origin? tip-contains-origin?))
        land (post-land-absorb-plan
              (assoc ctx :absorb-would-conflict? conflict?))]
    (cond
      (= bl1130 :skip-human-merge-in-progress) :skip-human-merge-in-progress
      (= land :noop) :noop
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
        (if (<= (count msg) 80) msg "BL-1120: human-merge-in-progress on master - not aborted")))))

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

(defn reconcile-enabled?
  "BL-1247 kill switch, pure: `config master_main_reconcile_enabled <bool>`
   from conf text. Fail-CLOSED (returns false, meaning the sweep does not
   run) for every shape but the literal value \"true\" as the FIRST token
   after the key - absent, empty, malformed, or unreadable (nil conf-text)
   all degrade to off. An unavailable answer must never authorise a
   destructive write, same posture as BL-1236's own third invariant one
   level up. Caller reads conf-text fresh on every sweep tick (never cached
   at daemon start) - this function's own purity is what makes that
   trivial to verify.

   Anchors on the value token, not `\\btrue\\b` anywhere on the line: a
   trailing comment such as `config master_main_reconcile_enabled false #
   flip to true once BL-1236 lands` would otherwise read the word \"true\"
   out of the comment and flip the switch ON despite the line's own value
   being \"false\" - the exact fail-open this switch exists to refuse."
  [conf-text]
  (let [line (->> (str/split-lines (or conf-text ""))
                  (filter #(str/starts-with? % "config master_main_reconcile_enabled"))
                  first)
        value (when line
                (second (re-find #"^config\s+master_main_reconcile_enabled\s+(\S+)" line)))]
    (= value "true")))

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

(defn merge-failure-reason
  "Map merge! outcome to persisted block reason. BL-1135: rematch outcomes
   stay distinct from conflict (Operator needs-a-human absorb paging)."
  [outcome]
  (case (or outcome :conflict)
    :human-merge-in-progress "human-merge-in-progress"
    :refuse-rematch "refuse-rematch"
    :rematch-bookkeeping "rematch-bookkeeping"
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

(defn deadlock-alert-text
  [{:keys [ahead behind reason]}]
  (str "⚠️ main-sync deadlock: local main ahead=" (or ahead 0)
       " behind=" (or behind 0)
       " (" (or reason "diverged-or-dirty") "). "
       "Coordinator bookkeeping held; wakes and drop-nudges suppressed until behind=0. "
       "Clear overlapping dirty paths or wait for BL-891 reconcile."))

(defn format-overlapping-path-hint
  "BL-1187: name actionable paths for operator/babysitter hints."
  [paths]
  (let [paths (vec (remove #(= unknown-dirty-marker %) (or paths [])))]
    (case (count paths)
      0 "inspect master checkout git status (BL-891 docs/how-to/BL-891-master-main-reconcile-sweep.md)"
      1 (str "clear overlapping path " (first paths))
      (<= (count paths) 3) (str "clear overlapping paths: " (str/join ", " paths))
      (str (count paths) " overlapping paths — see docs/how-to/BL-891-master-main-reconcile-sweep.md"))))

(defn operator-deadlock-hint
  "BL-1187: babysitterd/operator-facing hint when main-sync-deadlock is active."
  [{:keys [ahead behind reason overlapping-paths]}]
  (str "main-sync deadlock (" (or reason "diverged") "): local main ahead="
       (or ahead 0) " behind=" (or behind 0)
       "; coordinator bookkeeping halted — operator fix: "
       (format-overlapping-path-hint overlapping-paths)
       "; handoffd auto-reconciles once overlap clears (BL-891). Not /pilot."))

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
             origin main` attempt, no retry loop (bounded - a rejected
             push IS the genuine-divergence signal, not a transient
             failure to retry past; this project's own already-wired
             periodic push-sweep, BL-356, is what retries on a backoff
             curve, not this one-shot pre-reset attempt).
     :reset! (fn [] -> map) - the EXISTING reset-to-origin recovery,
             called only when the push above did not succeed; its return
             value is passed through completely unchanged, so no caller-
             visible contract changes on the genuine-divergence path.
   Returns {:success true :outcome :pushed} when the push alone already
   resolved everything (no reset needed), else reset!'s own result,
   verbatim."
  [{:keys [push! reset!]}]
  (let [push-result (push!)]
    (if (:success push-result)
      {:success true :outcome :pushed}
      (reset!))))

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
            (handle-merge-failure! daemon-dir state adapters behind handle-blocked! result)))))))
