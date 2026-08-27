#!/usr/bin/env bb

;; BL-328: pure staleness decision for "merged code never reaches the
;; running daemons" - a long-lived process (compiled Node OR interpreted
;; Babashka) loads its code once at startup and holds it in memory exactly
;; like Node does; a merge to main never reaches it without an explicit
;; recompile+restart. This file decides ONLY "is this process's own
;; captured build identity behind main's own HEAD" - no filesystem, no
;; git, no process I/O. The real state-gathering (reading each process's
;; own status file, running `git rev-parse main`) and the recompile+
;; restart action live in build_freshness_cli.bb, the coordinator-invoked
;; entry point (mirrors quiet_period_gate_cli.bb/role_lifecycle_cli.bb's
;; own CLI-wrapper shape).

(ns build-freshness-lib
  (:require [clojure.string :as str]))

(defn- blank->nil [s]
  (when-not (str/blank? s) s))

;; A process whose OWN captured sha is unresolvable (build_sha missing,
;; empty, or the compile/stamp step never ran) is never reported as stale -
;; the conservative default this codebase always uses when it genuinely
;; cannot know (never fabricate an answer from a "we don't know" state).
;; Only a REAL mismatch between two REAL shas counts.
(defn stale? [running-sha main-sha]
  (let [running (blank->nil running-sha)
        main (blank->nil main-sha)]
    (boolean (and running main (not= running main)))))

(defn freshness-entry
  "One process's freshness report: {:name :running_sha :main_sha :stale}."
  [{:keys [name running-sha]} main-sha]
  {:name name
   :running_sha (blank->nil running-sha)
   :main_sha (blank->nil main-sha)
   :stale (stale? running-sha main-sha)})

(defn freshness-report
  "Given every tracked process's {:name :running-sha} and main's own
   current HEAD sha, the whole swarm's freshness report - one entry per
   process, in the given order."
  [processes main-sha]
  (mapv #(freshness-entry % main-sha) processes))

(defn stale-process-names
  "Just the names of the processes a freshness-report flagged stale - the
   CLI's own sync action iterates exactly this list, never re-deciding
   staleness itself."
  [report]
  (mapv :name (filter :stale report)))

;; ── BL-629: sync refuses a `main` tip that is not QA-approved ─────────────
;; The deployed code surface is what `sync` actually ships: extension
;; compile inputs, and swarmforge/scripts/ excluding its own test/ subdir.
;; ONE definition, used identically for historical drift (a commit's changed
;; paths) and the working tree (git status's dirty paths) so the two checks
;; can never drift apart on what counts.
(defn on-deployed-surface?
  [path]
  (boolean
   (and path
        (or (str/starts-with? path "extension/src/")
            (= path "extension/package.json")
            (= path "extension/package-lock.json")
            (str/starts-with? path "extension/tsconfig")
            (and (str/starts-with? path "swarmforge/scripts/")
                 (not (str/starts-with? path "swarmforge/scripts/test/")))))))

(defn touches-deployed-surface?
  "A commit (or working-tree change) touches the surface if ANY of its
   changed paths does. The CLI supplies the changed paths (a git diff/status
   call) - this stays pure, no git/fs here."
  [changed-paths]
  (boolean (some on-deployed-surface? changed-paths)))

(defn code-drift-shas
  "Given the drift commits since the last QA-landed commit (each already
   flagged by the CLI whether it touches the deployed code surface), the
   shas that would refuse a sync - bookkeeping-only commits are silently
   excluded. Order is preserved from the input."
  [drift-commits]
  (mapv :sha (filter :touches-surface? drift-commits)))

(defn tip-approval-status
  "report's pure fact: is main's tip QA-approved, and if not, which commits
   are why. report never compiles or restarts, so - unlike sync-gate-decision
   below - the working tree and override never enter into this.
   facts-complete? (default true) is BL-629 architect bounce #1 finding 4: a
   git failure while gathering drift (no common ancestor, a `git log`/`diff-
   tree` failure) is UNKNOWN, not empty - reporting it as approved would be
   fabricating a clean answer from a gap. Unknown reads as NOT approved,
   with a distinct :gather-failed? marker so callers can tell 'unapproved'
   from 'could not tell'. The success-path shape is left untouched (still
   exactly {:approved? :offending-shas}) so existing callers/tests are
   unaffected."
  ([drift-commits] (tip-approval-status drift-commits true))
  ([drift-commits facts-complete?]
   (if facts-complete?
     (let [offending (code-drift-shas drift-commits)]
       {:approved? (empty? offending) :offending-shas offending})
     {:approved? false :offending-shas [] :gather-failed? true})))

(defn sync-gate-decision
  "Pure decision for whether `sync` may proceed. facts:
     :qa-ref-exists?      bool - whether the QA integration branch resolves
     :drift-commits       seq of {:sha :touches-surface?} since the last
                           QA-landed commit (ignored when qa-ref-exists? is
                           false - a missing ref fails closed regardless of
                           what drift-commits happens to hold)
     :dirty-surface-paths seq of uncommitted-modification paths already
                           filtered to the deployed surface by the CLI
     :facts-complete?     bool, default true - BL-629 architect bounce #1
                           finding 4: false when the CLI could not fully
                           gather the facts above (a merge-base/git-log/
                           diff-tree/git-status failure) - refuses just like
                           a missing ref, because an unknown answer is not a
                           clean one. Overridable via the same :override?
                           mechanism as every other refusal reason - it is
                           not a special case, just another reason.
     :override?           bool - explicit, one-shot override for THIS call
                           only (this function is pure/stateless, so an
                           override can never outlive its own invocation)
   Returns {:refuse? :reason (:missing-ref/:gather-failed/:code-drift/
            :dirty-surface/nil) :offending-shas :offending-paths
            :override-used?}."
  [{:keys [qa-ref-exists? drift-commits dirty-surface-paths override?]
    :as facts}]
  (let [facts-complete? (get facts :facts-complete? true)
        offending-shas (if qa-ref-exists? (code-drift-shas drift-commits) [])
        offending-paths (vec dirty-surface-paths)
        reason (cond
                 (not qa-ref-exists?) :missing-ref
                 (not facts-complete?) :gather-failed
                 (seq offending-shas) :code-drift
                 (seq offending-paths) :dirty-surface
                 :else nil)
        would-refuse? (some? reason)]
    {:refuse? (and would-refuse? (not override?))
     :reason reason
     :offending-shas offending-shas
     :offending-paths offending-paths
     :override-used? (and would-refuse? (boolean override?))}))

(defn execute-sync!
  "Adapter-injected: the gate-checked-first sync dispatch. `facts` is
   sync-gate-decision's own facts plus :processes/:main-sha for the
   post-gate staleness dispatch. adapters:
     :recompile!            (fn [] ...)
     :restart-group!        (fn [group] ...)
     :record-override!      (fn [gate] ...) - called only when the gate's
                             override was actually used
     :gather-settled-report (fn [] -> report) - called only once the gate
                             let the sync proceed
   A refusing gate returns immediately: recompile!/restart-group! are NEVER
   invoked. That ordering is proven here with a spy, not left to the
   acceptance fixture - a bare fixture repo has no stale processes, so
   'nothing was restarted' would otherwise be true for the wrong reason."
  [{:keys [processes main-sha] :as facts} adapters]
  (let [gate (sync-gate-decision facts)]
    (if (:refuse? gate)
      {:refused true :gate gate}
      (let [report (freshness-report processes main-sha)
            stale-names (set (stale-process-names report))
            stale-groups (->> processes (filter #(contains? stale-names (:name %))) (map :group) distinct)]
        (when (:override-used? gate)
          ((:record-override! adapters) gate))
        (when (seq stale-names)
          ((:recompile! adapters)))
        (doseq [group stale-groups]
          ((:restart-group! adapters) group))
        {:refused false
         :gate gate
         :report ((:gather-settled-report adapters))
         :restarted (mapv name stale-groups)}))))
