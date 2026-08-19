#!/usr/bin/env bb
;; TDD runner for master_main_reconcile_lib.bb (BL-891, narrowed by BL-919) -
;; no real git process, no real clock, no real network (every adapter is a
;; fake). Mirrors push_sweep_lib_test_runner.bb's own assert-battery shape.

(ns master-main-reconcile-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── porcelain-lines->paths ──────────────────────────────────────────────

(assert= "porcelain-lines->paths: blank input -> empty set"
         #{} (master-main-reconcile-lib/porcelain-lines->paths ""))
(assert= "porcelain-lines->paths: modified tracked file"
         #{"seed.txt"} (master-main-reconcile-lib/porcelain-lines->paths " M seed.txt"))
(assert= "porcelain-lines->paths: staged (added) file"
         #{"staged.txt"} (master-main-reconcile-lib/porcelain-lines->paths "A  staged.txt"))
(assert= "porcelain-lines->paths: untracked file"
         #{"newfile.txt"} (master-main-reconcile-lib/porcelain-lines->paths "?? newfile.txt"))
(assert= "porcelain-lines->paths: rename reports BOTH the old and new path"
         #{"old.txt" "new.txt"} (master-main-reconcile-lib/porcelain-lines->paths "R  old.txt -> new.txt"))
(assert= "porcelain-lines->paths: multiple lines, one set"
         #{"a.txt" "b.txt" "c.txt"}
         (master-main-reconcile-lib/porcelain-lines->paths " M a.txt\n?? b.txt\nA  c.txt"))
(assert= "porcelain-lines->paths: trailing blank line ignored"
         #{"a.txt"} (master-main-reconcile-lib/porcelain-lines->paths " M a.txt\n"))

;; ── overlapping-paths ───────────────────────────────────────────────────

(assert= "overlapping-paths: disjoint sets -> empty"
         #{} (master-main-reconcile-lib/overlapping-paths #{"a.txt"} #{"b.txt"}))
(assert= "overlapping-paths: shared path -> that path"
         #{"a.txt"} (master-main-reconcile-lib/overlapping-paths #{"a.txt" "b.txt"} #{"a.txt" "c.txt"}))
(assert= "overlapping-paths: empty dirty-paths never overlaps anything"
         #{} (master-main-reconcile-lib/overlapping-paths #{} #{"a.txt" "b.txt"}))

;; ── reconcile-decision ──────────────────────────────────────────────────

(assert= "reconcile-decision: nothing behind -> up-to-date, regardless of dirt"
         :up-to-date (master-main-reconcile-lib/reconcile-decision
                      {:behind 0 :dirty-paths #{"a.txt"} :merge-changed-paths #{"a.txt"}}))
(assert= "reconcile-decision: nothing behind, clean -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {:behind 0}))
(assert= "reconcile-decision: nil counts/paths default -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {}))
(assert= "reconcile-decision: behind, fully clean tree -> should-reconcile"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision {:behind 5}))
(assert= "reconcile-decision: BL-919 existence proof - behind, dirty tree, but the dirty path does NOT overlap the incoming merge -> should-reconcile (this is the whole point of the ticket)"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"landed-1.txt"}}))
(assert= "reconcile-decision: behind, dirty path IS one the incoming merge would change -> dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}}))
(assert= "reconcile-decision: untracked file clashing with a path the merge would create -> dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"clash.txt"} :merge-changed-paths #{"clash.txt" "other.txt"}}))
(assert= "reconcile-decision: multiple dirty paths, only ONE overlaps -> still dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"a.txt" "b.txt"} :merge-changed-paths #{"b.txt"}}))
(assert= "reconcile-decision: multiple dirty paths, NONE overlap -> should-reconcile"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{"a.txt" "b.txt"} :merge-changed-paths #{"c.txt"}}))
(assert= "reconcile-decision: uncertain dirty-check (unknown-dirty-marker present) always forces dirty-blocked, even with an empty merge-changed-paths"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{master-main-reconcile-lib/unknown-dirty-marker} :merge-changed-paths #{}}))
(assert= "reconcile-decision: uncertain merge-changed-paths computation with real dirt present forces dirty-blocked (can't rule out overlap)"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{master-main-reconcile-lib/unknown-dirty-marker}}))
(assert= "reconcile-decision: uncertain merge-changed-paths computation with a FULLY CLEAN tree still reconciles - nothing dirty could possibly overlap"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{} :merge-changed-paths #{master-main-reconcile-lib/unknown-dirty-marker}}))

;; ── drift-report ────────────────────────────────────────────────────────

(assert= "drift-report: passes both counts through"
         {:ahead 8 :behind 22} (master-main-reconcile-lib/drift-report {:ahead 8 :behind 22}))
(assert= "drift-report: nil counts default to 0"
         {:ahead 0 :behind 0} (master-main-reconcile-lib/drift-report {}))

;; ── surface-message / surface-draft-lines ──────────────────────────────

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{"seed.txt"}})]
  (assert-true "surface-message: dirty reason mentions behind count" (clojure.string/includes? msg "22"))
  (assert-true "surface-message: dirty reason names the single overlapping path" (clojure.string/includes? msg "seed.txt"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{"a.txt" "b.txt" "c.txt"}})]
  (assert-true "surface-message: multiple overlapping paths collapse to a count" (clojure.string/includes? msg "3 paths"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [long-path "backlog/active/BL-919-reconcile-refuses-only-real-conflicts.yaml"
      msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{long-path}})]
  (assert-true "surface-message: a path too long to fit falls back to the unnamed form rather than exceeding the limit"
               (not (clojure.string/includes? msg long-path)))
  (assert-true "surface-message: still stays within the 80-char note limit even for a long path" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{}})]
  (assert-true "surface-message: no named paths still mentions the behind count" (clojure.string/includes? msg "22"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 3 :reason :conflict})]
  (assert-true "surface-message: conflict reason mentions conflict" (clojure.string/includes? msg "conflict"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(assert= "surface-draft-lines: a note to the coordinator, priority 00"
         ["type: note" "to: coordinator" "priority: 00" "message: hello"]
         (master-main-reconcile-lib/surface-draft-lines "hello"))

;; ── sweep! (adapter-injected orchestration, real state-file fixture) ────

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-master-main-reconcile-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn mk-adapters
  "Every call is recorded so a test can assert not just the LOGGED outcome
   but which adapters actually fired - the property this whole ticket
   exists to guarantee is about what gets CALLED, not just what gets said."
  [{:keys [ahead behind dirty-paths merge-changed-paths merge-result]}]
  (let [calls (atom {:rev-counts! 0 :dirty-paths! 0 :merge-changed-paths! 0 :merge! 0 :surface! 0 :escalate! 0})
        logs (atom [])
        surfaced (atom [])
        escalated (atom [])]
    {:calls calls
     :logs logs
     :surfaced surfaced
     :escalated escalated
     :adapters
     {:rev-counts! (fn [] (swap! calls update :rev-counts! inc) {:ahead ahead :behind behind})
      :dirty-paths! (fn [] (swap! calls update :dirty-paths! inc) (or dirty-paths #{}))
      :merge-changed-paths! (fn [] (swap! calls update :merge-changed-paths! inc) (or merge-changed-paths #{}))
      :merge! (fn [] (swap! calls update :merge! inc) merge-result)
      :surface! (fn [msg] (swap! calls update :surface! inc) (swap! surfaced conj msg))
      :escalate! (fn [payload] (swap! calls update :escalate! inc) (swap! escalated conj payload))
      :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}}))

;; Default escalation threshold used by every sweep! call below unless a
;; test names its own - high enough (well above BL-920's own documented
;; default of 3) that no PRE-EXISTING test above accidentally starts
;; escalating just because it happens to call sweep! more than once against
;; the same state dir.
(def default-threshold 100)

;; up-to-date: merge! and surface! are never called
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep!: up-to-date never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: up-to-date never calls surface!" 0 (:surface! @calls))
  (assert= "sweep!: up-to-date never bothers computing merge-changed-paths (nothing to diff against)"
           0 (:merge-changed-paths! @calls)))

;; dirty-blocked (overlap): merge! is NEVER called (invariant 1: never
;; touches a tree it's not safe to touch), surface! IS called exactly once,
;; naming the reason
(let [{:keys [calls surfaced adapters]} (mk-adapters {:ahead 3 :behind 22
                                                        :dirty-paths #{"seed.txt"}
                                                        :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep!: dirty-blocked (overlap) never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: dirty-blocked (overlap) surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: dirty-blocked surfaced message names the behind count"
               (clojure.string/includes? (first @surfaced) "22"))
  (assert-true "sweep!: dirty-blocked surfaced message names the offending path"
               (clojure.string/includes? (first @surfaced) "seed.txt")))

;; BL-919's own existence proof, at the sweep! layer: a dirty tree whose
;; dirty path does NOT overlap what the merge would change reconciles
;; exactly like a clean tree would - merge! IS called, nothing is surfaced.
(let [{:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22
                                                    :dirty-paths #{"seed.txt"}
                                                    :merge-changed-paths #{"landed-1.txt"}
                                                    :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep!: non-overlapping dirt calls merge! exactly once (BL-919's own point)" 1 (:merge! @calls))
  (assert= "sweep!: non-overlapping dirt never surfaces" 0 (:surface! @calls))
  (assert-true "sweep!: non-overlapping dirt logs 'reconciled'"
               (some #(clojure.string/includes? % "reconciled") @logs)))

;; dirty-blocked repeated: a SECOND tick with the SAME overlap does not
;; re-surface (avoid spamming the coordinator every poll cycle)
(let [dir (mk-tmp)
      {:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (assert= "sweep!: dirty-blocked surfaces only once across repeated identical ticks" 1 (:surface! @calls)))

;; should-reconcile, merge succeeds: merge! called once, no surface, state cleared
(let [dir (mk-tmp)
      {:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (assert= "sweep!: should-reconcile calls merge! exactly once" 1 (:merge! @calls))
  (assert= "sweep!: a successful reconcile never surfaces" 0 (:surface! @calls))
  (assert-true "sweep!: a successful reconcile logs 'reconciled'"
               (some #(clojure.string/includes? % "reconciled") @logs))
  (assert= "sweep!: a successful reconcile clears persisted state"
           {} (master-main-reconcile-lib/read-state dir)))

;; should-reconcile, merge fails (conflict): surfaced exactly once, state records it
(let [dir (mk-tmp)
      {:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "CONFLICT"}})]
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (assert= "sweep!: a failed reconcile surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: a failed reconcile's surfaced message names 'conflict'"
               (clojure.string/includes? (first @surfaced) "conflict")))

;; idempotent re-run (ticket's own QA procedure (c)): once reconciled,
;; a SECOND tick against the now-up-to-date counts changes nothing further
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})
      second-tick (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters second-tick))
  (assert= "sweep!: re-run after reconciling calls merge! zero more times" 0 (:merge! @(:calls second-tick)))
  (assert= "sweep!: re-run after reconciling never surfaces" 0 (:surface! @(:calls second-tick))))

;; self-healing: a DIFFERENT block reason (conflict, after a prior dirty
;; surfacing) re-surfaces fresh rather than being suppressed by the stale flag
(let [dir (mk-tmp)
      dirty-tick (mk-adapters {:ahead 0 :behind 22
                                :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      conflict-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters dirty-tick))
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters conflict-tick))
  (assert= "sweep!: a new block REASON surfaces even right after a different reason was already surfaced"
           1 (:surface! @(:calls conflict-tick))))

;; uncertain dirty-check (real git status failure): the sentinel forces a
;; block even though nothing was actually diffed against
(let [{:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 0 :behind 22 :dirty-paths #{master-main-reconcile-lib/unknown-dirty-marker}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep!: an uncertain dirty-check never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: an uncertain dirty-check surfaces exactly once" 1 (:surface! @calls)))

;; ── BL-920: parse-escalation-threshold ─────────────────────────────────

(assert= "parse-escalation-threshold: absent config -> default"
         3 (master-main-reconcile-lib/parse-escalation-threshold ""))
(assert= "parse-escalation-threshold: honors a configured positive integer"
         7 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold 7"))
(assert= "parse-escalation-threshold: zero degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold 0"))
(assert= "parse-escalation-threshold: negative degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold -2"))
(assert= "parse-escalation-threshold: malformed value degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold not-a-number"))
(assert= "parse-escalation-threshold: an unrelated config line is ignored"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config active_backlog_max_depth 9"))

;; ── BL-920: next-block-state / escalation-due? (pure) ──────────────────

(assert= "next-block-state: no prior state -> fresh episode, ticks 1, not escalated"
         {:surfaced "dirty" :ticks 1 :escalated false}
         (master-main-reconcile-lib/next-block-state {} "dirty"))
(assert= "next-block-state: same reason as previous tick -> ticks increments, escalated carried"
         {:surfaced "dirty" :ticks 2 :escalated false}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 1 :escalated false} "dirty"))
(assert= "next-block-state: an already-escalated episode continuing the SAME reason keeps :escalated true"
         {:surfaced "dirty" :ticks 4 :escalated true}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 3 :escalated true} "dirty"))
(assert= "next-block-state: a DIFFERENT reason resets to a fresh episode, even if the prior one had escalated"
         {:surfaced "conflict" :ticks 1 :escalated false}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 5 :escalated true} "conflict"))

(assert-true "escalation-due?: below threshold -> not due"
             (not (master-main-reconcile-lib/escalation-due? {:ticks 2 :escalated false} 3)))
(assert-true "escalation-due?: exactly at threshold, not yet escalated -> due"
             (master-main-reconcile-lib/escalation-due? {:ticks 3 :escalated false} 3))
(assert-true "escalation-due?: past threshold, not yet escalated -> still due"
             (master-main-reconcile-lib/escalation-due? {:ticks 5 :escalated false} 3))
(assert-true "escalation-due?: at threshold but already escalated -> not due again"
             (not (master-main-reconcile-lib/escalation-due? {:ticks 3 :escalated true} 3)))

;; ── BL-920: escalation-reason / escalation-telegram-text / escalation-email-subject ──

(let [text (master-main-reconcile-lib/escalation-reason "dirty" 22 3)]
  (assert-true "escalation-reason: names the reason" (clojure.string/includes? text "dirty"))
  (assert-true "escalation-reason: names the behind count" (clojure.string/includes? text "22"))
  (assert-true "escalation-reason: names the tick count" (clojure.string/includes? text "3")))

(let [text (master-main-reconcile-lib/escalation-telegram-text "conflict" 9 5)]
  (assert-true "escalation-telegram-text: names the reason" (clojure.string/includes? text "conflict"))
  (assert-true "escalation-telegram-text: names the behind count" (clojure.string/includes? text "9"))
  (assert-true "escalation-telegram-text: names the tick count" (clojure.string/includes? text "5")))

(assert-true "escalation-email-subject: names the reason"
             (clojure.string/includes? (master-main-reconcile-lib/escalation-email-subject "dirty") "dirty"))

;; ── BL-920: sweep! integration - escalation is additive to, and separate
;;    from, the coordinator note (invariant 1) ──────────────────────────

;; First tick of a block: the coordinator note fires exactly as before;
;; escalate! does NOT fire (ticks=1 is below any sane threshold >1).
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 2 adapters)
  (assert= "sweep!: first tick of a block surfaces the coordinator note" 1 (:surface! @calls))
  (assert= "sweep!: first tick of a block never escalates" 0 (:escalate! @calls)))

;; threshold=1 is a real, reachable config value (parse-escalation-threshold
;; only rejects absent/zero/negative/malformed, never 1) and collapses the
;; first tick and the escalation onto the SAME tick: escalation-due? reads
;; (>= ticks 1), and the first tick's next-block-state already carries
;; :ticks 1. Both signals still fire - additive, never instead-of (invariant
;; 1 holds even at this boundary) - but nothing exercised this before, and
;; it is exactly the boundary condition most likely for an off-by-one to
;; silently invert (e.g. a caller mistaking "escalated on tick 1" for "the
;; threshold was never actually 1").
(let [{:keys [calls escalated adapters]} (mk-adapters {:ahead 0 :behind 22
                                                         :dirty-paths #{"seed.txt"}
                                                         :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 1 adapters)
  (assert= "sweep!: threshold=1 still surfaces the coordinator note on tick 1" 1 (:surface! @calls))
  (assert= "sweep!: threshold=1 also escalates on that same tick 1" 1 (:escalate! @calls))
  (assert= "sweep!: threshold=1 escalation payload's tick count is 1" 1 (:ticks (first @escalated))))

;; A state file written by pre-BL-920 code (or a mid-upgrade daemon restart)
;; has no :ticks/:escalated keys at all - only {:surfaced "dirty"}. This is
;; a real on-disk shape, not a hypothetical: it is exactly what write-state!
;; wrote before this ticket. next-block-state must treat the missing keys as
;; "no ticks yet" / "not escalated" (fnil/not-nil degrade), never crash, and
;; never silently skip the coordinator's already-fired note into a second
;; first-tick surface.
(let [dir (mk-tmp)]
  (master-main-reconcile-lib/write-state! dir {:surfaced "dirty"})
  (let [{:keys [calls escalated adapters]} (mk-adapters {:ahead 0 :behind 22
                                                           :dirty-paths #{"seed.txt"}
                                                           :merge-changed-paths #{"seed.txt"}})]
    (master-main-reconcile-lib/sweep! dir 1 adapters)
    (assert= "sweep!: an old-format state file (no :ticks/:escalated) for the SAME reason never re-surfaces"
             0 (:surface! @calls))
    (assert= "sweep!: an old-format state file's missing :ticks starts counting from this tick, not crashing"
             1 (:escalate! @calls))
    (assert= "sweep!: an old-format state file's first counted tick reports ticks=1"
             1 (:ticks (first @escalated)))))

;; The SAME reason persisting past threshold=2 escalates on the SECOND
;; consecutive tick - additive to (not instead of) the first tick's note.
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22
                                :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      second-tick (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters second-tick))
  (assert= "sweep!: second consecutive tick still does not re-surface the note"
           0 (:surface! @(:calls second-tick)))
  (assert= "sweep!: second consecutive tick (== threshold) escalates exactly once"
           1 (:escalate! @(:calls second-tick)))
  (let [payload (first @(:escalated second-tick))]
    (assert= "sweep!: escalation payload names the reason" "dirty" (:reason payload))
    (assert= "sweep!: escalation payload names the behind count" 22 (:behind payload))
    (assert= "sweep!: escalation payload names the tick count" 2 (:ticks payload))))

;; A THIRD consecutive tick of the same episode does not escalate again -
;; once per episode, not per tick (qa_e2e_procedure step 3).
(let [dir (mk-tmp)
      ticks (mapv (fn [_] (mk-adapters {:ahead 0 :behind 22
                                         :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}}))
                  (range 3))]
  (doseq [t ticks] (master-main-reconcile-lib/sweep! dir 2 (:adapters t)))
  (assert= "sweep!: a third consecutive tick past threshold does not re-escalate"
           0 (:escalate! @(:calls (nth ticks 2)))))

;; Resolving clears escalation state: after escalating, a successful
;; reconcile, then a NEW block of the SAME reason escalates again on its
;; own fresh schedule rather than being suppressed forever (invariant 2).
(let [dir (mk-tmp)
      tick1 (mk-adapters {:ahead 0 :behind 22
                           :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      tick2 (mk-adapters {:ahead 0 :behind 22
                           :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      resolve-tick (mk-adapters {:ahead 0 :behind 0})
      new-episode-tick1 (mk-adapters {:ahead 0 :behind 22
                                       :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      new-episode-tick2 (mk-adapters {:ahead 0 :behind 22
                                       :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick1))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick2))
  (assert= "sweep!: escalates once by the second tick of episode 1" 1 (:escalate! @(:calls tick2)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters resolve-tick))
  (assert= "sweep!: resolving clears persisted state entirely" {} (master-main-reconcile-lib/read-state dir))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters new-episode-tick1))
  (assert= "sweep!: a fresh episode's first tick does not immediately escalate"
           0 (:escalate! @(:calls new-episode-tick1)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters new-episode-tick2))
  (assert= "sweep!: a fresh episode escalates again on its OWN schedule, not suppressed by the resolved episode"
           1 (:escalate! @(:calls new-episode-tick2))))

;; A DIFFERENT block reason right after an escalated episode also starts
;; fresh (no immediate escalate) - judged on its own merits (invariant 2),
;; extended from surfaced-reason-changed to escalation state too.
(let [dir (mk-tmp)
      dirty-tick1 (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      dirty-tick2 (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      conflict-tick1 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters dirty-tick1))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters dirty-tick2))
  (assert= "sweep!: dirty episode escalates by its second tick" 1 (:escalate! @(:calls dirty-tick2)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters conflict-tick1))
  (assert= "sweep!: a new, unrelated block reason surfaces its own first-tick note"
           1 (:surface! @(:calls conflict-tick1)))
  (assert= "sweep!: a new, unrelated block reason does not inherit the prior episode's escalation"
           0 (:escalate! @(:calls conflict-tick1))))

;; The conflict reason escalates through the identical threshold machinery
;; (qa_e2e_procedure step 6 - "the human named both").
(let [dir (mk-tmp)
      tick1 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})
      tick2 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick1))
  (assert= "sweep!: conflict first tick surfaces, does not escalate" 0 (:escalate! @(:calls tick1)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick2))
  (assert= "sweep!: conflict second consecutive tick escalates exactly once" 1 (:escalate! @(:calls tick2)))
  (assert= "sweep!: conflict escalation payload names the conflict reason"
           "conflict" (:reason (first @(:escalated tick2)))))

;; A sweep that is never blocked never escalates.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 2 adapters)
  (assert= "sweep!: an up-to-date tick never escalates (sanity, matches the never-blocked never-escalates contract)"
           0 (:escalate! @calls)))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
