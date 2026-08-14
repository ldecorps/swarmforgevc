#!/usr/bin/env bb
;; BL-891: PROPERTY test over master_main_reconcile_lib.bb, covering the
;; ticket's own 2 declared invariants (coder-authored first, per BL-654):
;;
;;   1. "Reconciliation only ever moves the master checkout FORWARD:
;;      local-only commits stay reachable, and no reset, rebase, stash, or
;;      force-update is ever performed on it."
;;   2. "A master checkout that cannot be reconciled cleanly is surfaced
;;      with its reason and left byte-identical, never partially updated."
;;
;; Split across two layers, same posture push_sweep_lib_property_runner.bb
;; documents for its own Babashka/TS-convention gap: this file proves the
;; PURE decision/gating logic (no real git process, no real clock) against
;; a randomized generator; the real-git half of each invariant - local-only
;; commits genuinely reachable after a real `git merge`, the working tree
;; genuinely byte-identical after a real conflict abort - is proven
;; concretely against a real git fixture by
;; test_handoffd_master_main_reconcile_wiring.sh. sweep!'s only
;; state-mutating adapter is `:merge!`; both invariants reduce, at this
;; layer, to a single load-bearing claim each generated scenario checks:
;;   (1) `:merge!` is called if-and-only-if behind>0 AND the tree is
;;       clean - so a dirty tree is NEVER touched, and reconciliation is
;;       ATTEMPTED whenever it is safe (never silently stuck).
;;   (2) `:surface!` is called if-and-only-if this tick ends BLOCKED
;;       (dirty tree, or a merge that reported failure) - so a block is
;;       always loud, never silent, and a successful/up-to-date tick never
;;       spuriously alarms.

(ns master-main-reconcile-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "master-main-reconcile-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── seeded generator (identical LCG shape to push_sweep_lib_property_
;;    runner.bb / ambulance_lib_property_runner.bb) ─────────────────────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; BL-654 generator-reach: `behind` is drawn from a small pool WEIGHTED so
;; zero and non-zero are equally common (a wide/uniform int draw would make
;; behind=0 vanishingly rare relative to the interesting nonzero cases, or
;; vice versa) - both branches of reconcile-decision's own zero-check need
;; to be reachable often, not hoped for.
(def behind-pool [0 1 5 22])

(defn gen-scenario [s]
  (let [[behind s1] (gen-pick s behind-pool)
        [clean? s2] (gen-bool s1)
        [merge-success? s3] (gen-bool s2)]
    [{:behind behind :clean? clean? :merge-success? merge-success?} s3]))

;; ── independent oracle: a fresh restatement of the gating rule, built
;;    without calling reconcile-decision/sweep! themselves - same posture as
;;    push_sweep_lib_property_runner.bb's own oracle-lacks-qa-approval?. ────
(defn- oracle-should-mutate? [{:keys [behind clean?]}]
  (and (pos? behind) clean?))

(defn- oracle-should-surface? [{:keys [behind clean? merge-success?]}]
  (or (and (pos? behind) (not clean?))
      (and (pos? behind) clean? (not merge-success?))))

(defn- run-sweep-with-scenario [{:keys [behind clean? merge-success?]}]
  (let [merge-calls (atom 0)
        surface-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind behind})
                  :clean? (fn [] clean?)
                  :merge! (fn [] (swap! merge-calls inc)
                             (if merge-success? {:success true} {:success false :error "conflict"}))
                  :surface! (fn [_msg] (swap! surface-calls inc))
                  :log! (fn [& _parts] nil)}]
    (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
    {:merge-calls @merge-calls :surface-calls @surface-calls}))

;; ── invariant 1: never mutates a dirty tree, always attempts when safe ────
(check-all "master_main_reconcile_lib invariant 1: merge! fires iff (behind>0 AND clean) - never touches a dirty tree"
  gen-scenario
  (fn [scenario]
    (let [{:keys [merge-calls]} (run-sweep-with-scenario scenario)
          expect-mutate? (oracle-should-mutate? scenario)]
      (cond
        (and expect-mutate? (not= 1 merge-calls))
        (str "LIVENESS VIOLATION: oracle says reconcile should be attempted but merge! fired " merge-calls " time(s)")

        (and (not expect-mutate?) (pos? merge-calls))
        (str "SAFETY VIOLATION: oracle says this tick must NOT mutate (dirty tree or already up-to-date) but merge! fired " merge-calls " time(s)")

        :else true))))

;; ── invariant 2: a block is always loud (surfaced), a clean tick never
;;    spuriously alarms ──────────────────────────────────────────────────
(check-all "master_main_reconcile_lib invariant 2: surface! fires iff this tick ends blocked - never silent, never spurious"
  gen-scenario
  (fn [scenario]
    (let [{:keys [surface-calls]} (run-sweep-with-scenario scenario)
          expect-surface? (oracle-should-surface? scenario)]
      (cond
        (and expect-surface? (not= 1 surface-calls))
        (str "LOUDNESS VIOLATION: oracle says this tick is blocked but surface! fired " surface-calls " time(s), not exactly once")

        (and (not expect-surface?) (pos? surface-calls))
        (str "SPURIOUS-ALARM VIOLATION: oracle says this tick is not blocked but surface! fired " surface-calls " time(s)")

        :else true))))

;; ── non-vacuity: each property MUST actually fail against a deliberately
;;    broken implementation, proven here rather than asserted (BL-654's own
;;    generator-reach rule - a property that can never fail is worth
;;    nothing). ───────────────────────────────────────────────────────────

;; Mutant A: a sweep! that ignores :clean? entirely and reconciles whenever
;; behind>0 - exactly the bug invariant 1 exists to prevent (touching a
;; dirty master checkout, which routinely holds in-progress backlog edits).
(defn- mutant-ignores-dirty-tree! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))]
    (when (pos? behind)
      ((:merge! adapters)))))

(defn- non-vacuity-check-dirty-tree []
  (let [dirty-behind-scenario {:behind 22 :clean? false :merge-success? true}
        merge-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :clean? (fn [] false)
                  :merge! (fn [] (swap! merge-calls inc) {:success true})
                  :surface! (fn [_msg] nil)
                  :log! (fn [& _parts] nil)}]
    (mutant-ignores-dirty-tree! (mk-tmp) adapters)
    (if (and (not (oracle-should-mutate? dirty-behind-scenario)) (pos? @merge-calls))
      (println "non-vacuity confirmed: invariant 1's oracle would flag a mutant that merges a dirty tree (merge! fired when it must not)")
      (do (println (str "NON-VACUITY FAILURE (dirty-tree mutant): expected the oracle to forbid mutation and the mutant to violate it; merge-calls=" @merge-calls))
          (System/exit 1)))))

(non-vacuity-check-dirty-tree)

;; Mutant B: a sweep! that blocks silently - decides not to reconcile a
;; dirty tree (correctly) but never tells the coordinator why. Exactly the
;; bug invariant 2 exists to prevent: staleness that is confidently wrong
;; rather than obviously broken (the ticket's own `notes:` incident).
(defn- mutant-silent-block! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))
        clean? ((:clean? adapters))]
    (when (and (pos? behind) clean?)
      ((:merge! adapters)))))
  ;; note: no :surface! call on the dirty-blocked path at all

(defn- non-vacuity-check-silent-block []
  (let [dirty-scenario {:behind 22 :clean? false :merge-success? true}
        surface-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :clean? (fn [] false)
                  :merge! (fn [] {:success true})
                  :surface! (fn [_msg] (swap! surface-calls inc))
                  :log! (fn [& _parts] nil)}]
    (mutant-silent-block! (mk-tmp) adapters)
    (if (and (oracle-should-surface? dirty-scenario) (zero? @surface-calls))
      (println "non-vacuity confirmed: invariant 2's oracle would flag a mutant that blocks a dirty tree without ever surfacing why")
      (do (println (str "NON-VACUITY FAILURE (silent-block mutant): expected the oracle to require surfacing and the mutant to violate it; surface-calls=" @surface-calls))
          (System/exit 1)))))

(non-vacuity-check-silent-block)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "master_main_reconcile_lib property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
