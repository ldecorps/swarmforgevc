;; BL-1118: after a Cursor/operator batch advances local main, immediately
;; fetch+merge origin/main under BL-891 invariants (never stash; abort on
;; conflict; print conflicted paths). Honesty refresh: a clean behind tip
;; must not stay stuck on a stale dirty sync reason.
;;
;; BL-1198: the colliding-local-ahead / conflict recovery paths below DO
;; reset onto origin/main via the injected rematch! adapter (never a
;; conflicted absorb an operator would have to finish by hand) - the
;; adapter itself now attempts a push first (see
;; master_main_reconcile_lib.bb's rematch-with-push-first!) so a genuine,
;; not-yet-published local commit is never silently discarded by that
;; reset when a plain fast-forward push would have sufficed instead.
;;
;;   (load-file ".../post_hotfix_merge_origin_lib.bb")
;;   post-hotfix-merge-origin-lib/foo

(ns post-hotfix-merge-origin-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_main_reconcile_lib.bb")))

(defn honest-reconcile-surfaced
  "When the worktree has no dirty paths, drop a stale 'dirty' surfaced reason
   so sync-action is wait-reconcile/ff-only — never wait-dirty-clear."
  [dirty-paths reconcile-surfaced]
  (if (and (empty? dirty-paths) (= "dirty" (str reconcile-surfaced)))
    nil
    reconcile-surfaced))

(defn post-merge-plan
  "Pure: :noop when not behind, else :attempt-merge."
  [behind]
  (if (zero? (or behind 0)) :noop :attempt-merge))

(defn conflicted-paths-from-status
  "Parse porcelain status lines that mark unmerged paths."
  [porcelain]
  (->> (str/split-lines (or porcelain ""))
       (keep (fn [line]
               (when (re-find #"^U|^.U|^AA|^DD" line)
                 (str/trim (subs line 2)))))
       (remove str/blank?)
       vec))

(defn- refresh-honest-surfaced!
  [daemon-dir dirty-paths]
  (let [state (master-main-reconcile-lib/read-state daemon-dir)
        honest (honest-reconcile-surfaced dirty-paths (:surfaced state))]
    (when (not= honest (:surfaced state))
      (master-main-reconcile-lib/write-state! daemon-dir (assoc state :surfaced honest)))
    honest))

(defn- finish-ok
  [daemon-dir rev-counts! outcome]
  (let [{:keys [ahead behind]} (rev-counts!)]
    (when (master-main-reconcile-lib/deadlock-clear? behind)
      (master-main-reconcile-lib/clear-deadlock! daemon-dir)
      ;; BL-1141: successful rematch clears standing refuse-rematch surface.
      (master-main-reconcile-lib/write-state! daemon-dir {}))
    {:ok? true :exit 0 :outcome outcome :ahead ahead :behind behind}))

(def ^:private refuse-rematch-line
  "BL-1130: absorb refused — rematch tip onto origin/main (no editor)")

(defn- surface-absorb-failure
  [rev-counts! outcome message]
  (binding [*out* *err*] (println message))
  {:ok? false :exit 1 :outcome outcome
   :mid-merge? false
   :ahead (:ahead (rev-counts!)) :behind (:behind (rev-counts!))})

(defn- finish-rematch-recovery
  "Shared rematch-or-surface path for refuse-rematch and rematch-bookkeeping.
   BL-1310: rematch!'s own reset adapter is gated by master_main_reconcile_
   lib.bb's refuse-reset-if-local-ahead! - a local-ahead refusal reports
   :local-ahead-refused, not the generic fail-outcome/fail-message (a
   durable block a human resolves, never a transient failure worth
   retrying unattended)."
  [daemon-dir rev-counts! mid-merge? rematch!
   {:keys [success-outcome fail-outcome fail-message no-rematch-message]}]
  (cond
    (mid-merge?)
    {:ok? false :exit 1 :outcome :human-merge-in-progress :mid-merge? true}

    rematch!
    (let [r (rematch!)]
      (cond
        (:success r) (finish-ok daemon-dir rev-counts! success-outcome)
        (= :local-ahead-refused (:outcome r))
        (surface-absorb-failure rev-counts! :local-ahead-refused
                                 (or (:error r) "BL-1310: local-ahead commits present - refused, not reset"))
        :else (surface-absorb-failure rev-counts! fail-outcome fail-message)))

    :else
    (surface-absorb-failure rev-counts! fail-outcome no-rematch-message)))

(defn- finish-refuse-rematch
  "BL-1141: refuse-rematch recovers by rematching onto origin/main when
   rematch! is provided — never print+exit alone as the standing path."
  [daemon-dir rev-counts! mid-merge? rematch!]
  (finish-rematch-recovery daemon-dir rev-counts! mid-merge? rematch!
                           {:success-outcome :rematched-refuse
                            :fail-outcome :refuse-rematch
                            :fail-message "BL-1141: rematch after refuse failed — will retry (no operator merge)"
                            :no-rematch-message refuse-rematch-line}))

(defn- finish-conflict
  [abort! status-porcelain! mid-merge? merge-res daemon-dir rev-counts! rematch!]
  (abort!)
  ;; BL-1130: designed recovery is rematch/refuse — never leave mid-merge.
  (when (mid-merge?)
    (abort!))
  (let [paths (or (:conflicted-paths merge-res)
                  (conflicted-paths-from-status (status-porcelain!)))
        result (finish-refuse-rematch daemon-dir rev-counts! mid-merge? rematch!)]
    (binding [*out* *err*]
      (println "CONFLICTED:" (str/join " " paths)))
    (cond-> result
      (seq paths) (assoc :conflicted-paths paths))))

(defn- finish-replay-bookkeeping
  "BL-1131/1138: colliding local-ahead → rematch onto origin/main when
   rematch! is provided; otherwise surface rematch-bookkeeping (no operator)."
  [daemon-dir rev-counts! mid-merge? rematch!]
  (finish-rematch-recovery daemon-dir rev-counts! mid-merge? rematch!
                           {:success-outcome :rematched-bookkeeping
                            :fail-outcome :rematch-bookkeeping
                            :fail-message "BL-1138: rematch bookkeeping failed — will retry (no operator merge)"
                            :no-rematch-message "BL-1131: absorb deferred — rematch bookkeeping onto origin/main (no operator merge)"}))

(defn run-post-hotfix-merge!
  "Fetch origin/main; absorb when behind under BL-1131 rematch-then-FF.
   FF-only, then a real 3-way merge3! (BL-1214), then noop when clean;
   colliding local-ahead → rematch! onto origin/main (BL-1138), else
   surface rematch-bookkeeping. Predicted or real conflict (both merge!
   and merge3! failed) → rematch! when wired (BL-1141), else refuse-rematch
   without MERGE_HEAD (BL-1130). An unavailable merge-verdict! (git could
   not answer) surfaces and exits non-zero without attempting anything
   (BL-1236) - never treated as a conflict, never as clean. Never stash;
   never pages operator absorb. rematch! itself attempts a push before any
   reset (BL-1198) - this function has no visibility into that, by design.
   merge3! is optional (nil-safe) so a caller not yet wired for BL-1214
   keeps today's ff-only-then-rematch behavior unchanged."
  [{:keys [daemon-dir fetch! rev-counts! dirty-paths! merge! merge3! abort!
           status-porcelain! mid-merge? merge-verdict! tip-contains-origin!
           rematch!]}]
  (fetch!)
  (refresh-honest-surfaced! daemon-dir (set (or (dirty-paths!) #{})))
  (let [{:keys [ahead behind]} (rev-counts!)
        tip-ok? (boolean (when tip-contains-origin! (tip-contains-origin!)))
        ;; BL-1236: an unwired merge-verdict! adapter is treated as
        ;; :unavailable, never :clean - an absent answer must never be
        ;; assumed safe.
        verdict (if merge-verdict! (merge-verdict!) :unavailable)
        conflict? (= verdict :conflict)
        unavailable? (= verdict :unavailable)
        plan (master-main-reconcile-lib/absorb-dispatch-plan
              {:merge-head-present? (boolean (mid-merge?))
               :behind behind
               :ahead ahead
               :tip-contains-origin? tip-ok?
               :would-conflict? conflict?
               :absorb-would-conflict? conflict?
               :verdict-unavailable? unavailable?})]
    (case plan
      :skip-human-merge-in-progress
      {:ok? false :exit 1 :outcome :human-merge-in-progress :mid-merge? true}

      :noop
      (finish-ok daemon-dir rev-counts! :noop)

      ;; BL-1236 invariant 3: git could not produce a verdict - surface and
      ;; exit non-zero, but never reset (never even attempt a merge that
      ;; could fall to one on its own failure).
      :verdict-unavailable
      (surface-absorb-failure rev-counts! :verdict-unavailable
                               "BL-1236: merge verdict unavailable — not reset (rerun once git can answer)")

      :replay-bookkeeping
      (finish-replay-bookkeeping daemon-dir rev-counts! mid-merge? rematch!)

      :refuse-rematch
      (finish-refuse-rematch daemon-dir rev-counts! mid-merge? rematch!)

      ;; :ff-absorb — CLI merge! is --ff-only; merge3! (BL-1214) is a real
      ;; 3-way attempt tried before falling back to conflict recovery. On
      ;; fallback, conflicted-paths comes from status-porcelain! (finish-
      ;; conflict's own fallback when merge-res carries none) - it reads
      ;; the working tree directly, so it is accurate for whichever of
      ;; merge!/merge3! actually left the conflict.
      (let [result (master-main-reconcile-lib/absorb-with-merge!
                    {:ff! merge!
                     :merge! (or merge3! (fn [] {:success false}))
                     :abort! abort!
                     :fallback! (fn []
                                  ;; finish-conflict itself also aborts
                                  ;; (BL-1130's own defensive double-abort);
                                  ;; harmless no-op the second time.
                                  (finish-conflict abort! status-porcelain! mid-merge? {}
                                                   daemon-dir rev-counts! rematch!))})]
        ;; BL-1214 architect bounce D1: absorb-with-merge! returns :outcome
        ;; :ff for the ordinary, most common case (a plain fast-forward, no
        ;; divergence at all) - not :merged, which is only the NEW
        ;; non-conflicting-two-way-divergence case this ticket adds. Treat
        ;; every :success true outcome uniformly, or an ordinary
        ;; fast-forward success falls into the bare-passthrough branch below
        ;; (no :ok?/:exit key, deadlock marker never cleared) and the CLI
        ;; reports it as a failure (exit 1) instead of success (exit 0).
        (if (:success result)
          (finish-ok daemon-dir rev-counts! (:outcome result))
          result)))))
