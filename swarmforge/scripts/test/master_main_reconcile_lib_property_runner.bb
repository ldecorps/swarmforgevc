#!/usr/bin/env bb
;; PROPERTY test over master_main_reconcile_lib.bb, covering both BL-891's
;; original 2 declared invariants and BL-919's own 3 declared invariants
;; (coder-authored first, per BL-654). BL-919's invariants:
;;
;;   1. "The sweep never stashes, resets, rebases, or force-updates, and
;;      every commit reachable before it runs is still reachable after."
;;   2. "A sweep that does not complete a merge leaves the checkout exactly
;;      as it found it - uncommitted changes untouched, never left
;;      mid-merge."
;;   3. "Narrowing the gate is strictly one-directional: every working-tree
;;      state the old gate allowed to reconcile still reconciles. The fix
;;      may only widen what proceeds, never block something that used to
;;      pass."
;;
;; Invariants 1 and 2 restate BL-891's own invariants 1 and 2 almost word
;; for word - unsurprising, since master-main-reconcile-merge! (the ONE
;; state-mutating adapter) is UNCHANGED by BL-919: still a plain
;; `git merge --no-edit origin/main`, abort-on-any-failure. Split across two
;; layers, same posture this file has always documented: this file proves
;; the PURE decision/gating logic (no real git process, no real clock)
;; against a randomized generator; the real-git half of each invariant -
;; local-only commits genuinely reachable after a real `git merge`, the
;; working tree genuinely byte-identical after a real conflict abort or a
;; real non-overlapping-dirt reconcile - is proven concretely against a
;; real git fixture by test_handoffd_master_main_reconcile_wiring.sh.
;; sweep!'s only state-mutating adapter is `:merge!`; invariants 1 and 2
;; reduce, at this layer, to the same single load-bearing claim each
;; generated scenario checks: `:merge!` fires if-and-only-if this tick is
;; genuinely safe to mutate (behind>0 AND no dirty/merge-changed path
;; overlap) - so a risky tree is NEVER touched, and reconciliation is
;; ATTEMPTED whenever it is safe (never silently stuck); and `:surface!`
;; fires if-and-only-if this tick ends BLOCKED, so a block is always loud,
;; never silent.
;;
;; Invariant 3 is BL-919's genuinely NEW property: it compares this
;; implementation's decision against an independent restatement of the OLD
;; (BL-891-era) blanket "any dirt blocks" gate, over the SAME generated
;; scenario, and asserts the old gate's :should-reconcile is never lost.
;;
;; BL-1198's own declared invariant (coder-authored first, per BL-654):
;;   "A commit on local main is never discarded by a rematch/reset path
;;   without that path first attempting to push it to origin."
;; Encoded directly over rematch-with-push-first! (the ONE shared primitive
;; all three real reset call sites - handoffd.bb, swarm_heal.bb,
;; post_hotfix_merge_origin.bb - now route through): over every generated
;; push outcome, reset! never fires except immediately after push! was
;; attempted and reported failure, and a SUCCESSFUL push never also calls
;; reset! (the commit is already safely on origin - nothing left to
;; discard). The real-git half (a genuine, undiverged local-ahead commit
;; surviving on origin without a reset) is unit-proven directly against the
;; shared primitive above (master_main_reconcile_lib_test_runner.bb); no
;; separate real-git fixture per call site is needed since all three now
;; share this one orchestration function, per this ticket's own
;; qa_e2e_procedure ("each of the three rematch call sites (or the shared
;; primitive once centralized)").

(ns master-main-reconcile-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.set :as set]))

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

;; BL-919 generator-reach: dirty-paths/merge-changed-paths are subsets of a
;; small 3-path pool, generated by an independent include/exclude coin flip
;; PER PATH - this reaches all 2^3 = 8 subsets of each with roughly uniform
;; probability (rather than e.g. picking a single random path per set, which
;; would make "two dirty paths, one overlapping" astronomically rarer than
;; it needs to be for a set-overlap property). With two independent 8-subset
;; draws that is 64 (dirty, merge-changed) combinations per behind/merge-
;; success value - both "some overlap" and "disjoint but both non-empty" are
;; common outcomes, not edge cases the generator only stumbles into.
(def path-pool ["a.txt" "b.txt" "c.txt"])

(defn- gen-subset [s pool]
  (loop [i 0 s s acc #{}]
    (if (= i (count pool))
      [acc s]
      (let [[include? s'] (gen-bool s)]
        (recur (inc i) s' (if include? (conj acc (nth pool i)) acc))))))

(defn gen-scenario [s]
  (let [[behind s1] (gen-pick s behind-pool)
        [dirty-paths s2] (gen-subset s1 path-pool)
        [merge-changed-paths s3] (gen-subset s2 path-pool)
        [merge-success? s4] (gen-bool s3)]
    [{:behind behind :dirty-paths dirty-paths :merge-changed-paths merge-changed-paths
      :merge-success? merge-success?}
     s4]))

;; ── independent oracles: fresh restatements of the gating rules, built
;;    without calling reconcile-decision/sweep! themselves - same posture as
;;    push_sweep_lib_property_runner.bb's own oracle-lacks-qa-approval?. ────
(defn- oracle-overlap? [{:keys [dirty-paths merge-changed-paths]}]
  (boolean (seq (set/intersection (set dirty-paths) (set merge-changed-paths)))))

(defn- oracle-should-mutate? [{:keys [behind] :as scenario}]
  (and (pos? behind) (not (oracle-overlap? scenario))))

(defn- oracle-should-surface? [{:keys [behind merge-success?] :as scenario}]
  (or (and (pos? behind) (oracle-overlap? scenario))
      (and (pos? behind) (not (oracle-overlap? scenario)) (not merge-success?))))

;; BL-919 invariant 3's own independent oracle: the OLD (BL-891-era)
;; blanket gate, restated fresh here rather than by calling any current
;; production code - "any dirt at all blocks, regardless of what it is."
(defn- oracle-old-gate-should-mutate? [{:keys [behind dirty-paths]}]
  (and (pos? behind) (empty? dirty-paths)))

;; A single scenario is always exercised as ONE isolated tick against a
;; fresh temp dir (ticks can never exceed 1), so a threshold far above any
;; single tick keeps invariants 1-3 (which say nothing about escalation)
;; free of any incidental :escalate! firing.
(def single-tick-threshold 100)

(defn- run-sweep-with-scenario [{:keys [behind dirty-paths merge-changed-paths merge-success?]}]
  (let [dirty-paths-calls (atom 0)
        merge-changed-paths-calls (atom 0)
        merge-calls (atom 0)
        surface-calls (atom 0)
        escalate-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind behind})
                  :dirty-paths! (fn [] (swap! dirty-paths-calls inc) dirty-paths)
                  :merge-changed-paths! (fn [] (swap! merge-changed-paths-calls inc) merge-changed-paths)
                  :merge! (fn [] (swap! merge-calls inc)
                             (if merge-success? {:success true} {:success false :error "conflict"}))
                  :surface! (fn [_msg] (swap! surface-calls inc))
                  :escalate! (fn [_payload] (swap! escalate-calls inc))
                  :log! (fn [& _parts] nil)}]
    (master-main-reconcile-lib/sweep! (mk-tmp) single-tick-threshold adapters)
    {:merge-calls @merge-calls :surface-calls @surface-calls :escalate-calls @escalate-calls}))

;; ── invariant 1: never mutates a tree it is unsafe to touch, always
;;    attempts when safe ────────────────────────────────────────────────
(check-all "master_main_reconcile_lib invariant 1: merge! fires iff (behind>0 AND no dirty/merge-changed overlap) - never touches an unsafe tree"
  gen-scenario
  (fn [scenario]
    (let [{:keys [merge-calls]} (run-sweep-with-scenario scenario)
          expect-mutate? (oracle-should-mutate? scenario)]
      (cond
        (and expect-mutate? (not= 1 merge-calls))
        (str "LIVENESS VIOLATION: oracle says reconcile should be attempted but merge! fired " merge-calls " time(s)")

        (and (not expect-mutate?) (pos? merge-calls))
        (str "SAFETY VIOLATION: oracle says this tick must NOT mutate (unsafe overlap, or already up-to-date) but merge! fired " merge-calls " time(s)")

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

;; ── invariant 3 (BL-919's own): narrowing the gate is strictly
;;    one-directional - every scenario the OLD blanket-dirty gate would
;;    have reconciled, THIS implementation also reconciles. ───────────────
(check-all "master_main_reconcile_lib invariant 3 (BL-919): the old gate's should-reconcile is never lost - narrowing only ever WIDENS what proceeds"
  gen-scenario
  (fn [scenario]
    (let [{:keys [merge-calls]} (run-sweep-with-scenario scenario)
          old-would-reconcile? (oracle-old-gate-should-mutate? scenario)]
      (if (and old-would-reconcile? (not= 1 merge-calls))
        (str "REGRESSION: the pre-BL-919 gate would have reconciled this exact state (behind>0, fully clean tree) but merge! fired " merge-calls " time(s) instead of 1")
        true))))

;; ── BL-920's own 2 declared invariants: escalation is additive to the
;;    coordinator note and only fires once persistence crosses a threshold
;;    (invariant 4), and resolving a block clears escalation state so a
;;    later unrelated block is judged fresh (invariant 5). Unlike
;;    invariants 1-3 above, these are properties of a SEQUENCE of ticks
;;    against the SAME state dir, not a single isolated scenario - the
;;    generator below produces a randomized sequence of blocked/resolved
;;    ticks and a randomized threshold, and an independent oracle
;;    (streak-reason/streak-count/escalated, tracked fresh in the test
;;    driver, never by calling next-block-state/escalation-due? themselves)
;;    predicts exactly which ticks surface and which escalate. ───────────

;; BL-654 generator-reach: :resolved is weighted lighter than the two
;; blocked kinds so multi-tick STREAKS (the case escalation logic actually
;; exercises) are common, while resolution/reset is still reached often
;; enough across a run of many sequences to exercise invariant 5.
(def tick-kind-pool [:dirty :dirty :conflict :conflict :resolved])
(def threshold-pool [2 3 5])

(defn gen-tick-sequence [s]
  (let [[threshold s1] (gen-pick s threshold-pool)
        [len-idx s2] (gen-int s1 6)
        len (inc len-idx)]
    (loop [i 0 s s2 kinds []]
      (if (= i len)
        [{:threshold threshold :kinds kinds} s]
        (let [[k s'] (gen-pick s tick-kind-pool)]
          (recur (inc i) s' (conj kinds k)))))))

;; ── independent oracle: a fresh restatement of the tick-persistence/
;;    escalate-once state machine, never calling next-block-state or
;;    escalation-due? itself. ─────────────────────────────────────────────
(defn- oracle-tick-step
  [{:keys [reason count escalated]} tick-kind threshold]
  (if (= tick-kind :resolved)
    {:state {:reason nil :count 0 :escalated false} :surface? false :escalate? false}
    (let [tick-reason (name tick-kind)]
      (if (= reason tick-reason)
        (let [count' (inc count)
              escalate? (and (>= count' threshold) (not escalated))]
          {:state {:reason tick-reason :count count' :escalated (or escalated escalate?)}
           :surface? false :escalate? escalate?})
        (let [count' 1
              escalate? (>= count' threshold)]
          {:state {:reason tick-reason :count count' :escalated escalate?}
           :surface? true :escalate? escalate?})))))

;; Runs the whole generated sequence against ONE real state dir (mirroring
;; production: ticks of the same episode share persisted state) and returns
;; a seq of mismatch strings, one per tick where the actual surface!/
;; escalate! call count disagreed with the independent oracle - empty when
;; every tick in the sequence matched.
(defn- run-tick-sequence [{:keys [threshold kinds]}]
  (let [dir (mk-tmp)]
    (loop [remaining kinds oracle-state {:reason nil :count 0 :escalated false} i 0 mismatches []]
      (if (empty? remaining)
        mismatches
        (let [kind (first remaining)
              {:keys [state surface? escalate?]} (oracle-tick-step oracle-state kind threshold)
              behind (if (= kind :resolved) 0 22)
              merge-success? (= kind :resolved)
              surface-calls (atom 0)
              escalate-calls (atom 0)
              adapters {:rev-counts! (fn [] {:ahead 0 :behind behind})
                        :dirty-paths! (fn [] (if (= kind :dirty) #{"seed.txt"} #{}))
                        :merge-changed-paths! (fn [] (if (= kind :dirty) #{"seed.txt"} #{}))
                        :merge! (fn [] (if merge-success? {:success true} {:success false :error "conflict"}))
                        :surface! (fn [_msg] (swap! surface-calls inc))
                        :escalate! (fn [_payload] (swap! escalate-calls inc))
                        :log! (fn [& _parts] nil)}]
          (master-main-reconcile-lib/sweep! dir threshold adapters)
          (recur (rest remaining)
                 state
                 (inc i)
                 (cond-> mismatches
                   (not= (boolean surface?) (pos? @surface-calls))
                   (conj (str "tick " i " kind=" kind " expected surface?=" surface? " got surface-calls=" @surface-calls))

                   (not= (boolean escalate?) (pos? @escalate-calls))
                   (conj (str "tick " i " kind=" kind " expected escalate?=" escalate? " got escalate-calls=" @escalate-calls)))))))))

(check-all "master_main_reconcile_lib invariants 4 & 5 (BL-920): escalation is additive to the coordinator note and fires iff the SAME block reason has persisted >= threshold consecutive ticks without already having escalated this episode (inv 4); resolving a block (or the reason changing) clears escalation state, so a later episode is judged on its own merits and never suppressed by a stale flag from one that already ended (inv 5)"
  gen-tick-sequence
  (fn [sequence]
    (let [mismatches (run-tick-sequence sequence)]
      (if (seq mismatches) (clojure.string/join "; " mismatches) true))))

;; ── non-vacuity: each property MUST actually fail against a deliberately
;;    broken implementation, proven here rather than asserted (BL-654's own
;;    generator-reach rule - a property that can never fail is worth
;;    nothing). ───────────────────────────────────────────────────────────

;; Mutant A: a sweep! that ignores dirty/merge-changed overlap entirely and
;; reconciles whenever behind>0 - exactly the bug invariant 1 exists to
;; prevent (touching a checkout with a real, overlapping local change).
(defn- mutant-ignores-overlap! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))]
    (when (pos? behind)
      ((:merge! adapters)))))

(defn- non-vacuity-check-ignores-overlap []
  (let [overlap-scenario {:behind 22 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"} :merge-success? true}
        merge-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :dirty-paths! (fn [] #{"seed.txt"})
                  :merge-changed-paths! (fn [] #{"seed.txt"})
                  :merge! (fn [] (swap! merge-calls inc) {:success true})
                  :surface! (fn [_msg] nil)
                  :log! (fn [& _parts] nil)}]
    (mutant-ignores-overlap! (mk-tmp) adapters)
    (if (and (not (oracle-should-mutate? overlap-scenario)) (pos? @merge-calls))
      (println "non-vacuity confirmed: invariant 1's oracle would flag a mutant that merges an overlapping-dirty tree (merge! fired when it must not)")
      (do (println (str "NON-VACUITY FAILURE (ignores-overlap mutant): expected the oracle to forbid mutation and the mutant to violate it; merge-calls=" @merge-calls))
          (System/exit 1)))))

(non-vacuity-check-ignores-overlap)

;; Mutant B: a sweep! that blocks silently - decides not to reconcile an
;; overlapping-dirty tree (correctly) but never tells the coordinator why.
;; Exactly the bug invariant 2 exists to prevent: staleness that is
;; confidently wrong rather than obviously broken (the ticket's own
;; incident, BL-891's `notes:`).
(defn- mutant-silent-block! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))
        dirty-paths ((:dirty-paths! adapters))
        merge-changed-paths ((:merge-changed-paths! adapters))
        overlap? (boolean (seq (set/intersection (set dirty-paths) (set merge-changed-paths))))]
    (when (and (pos? behind) (not overlap?))
      ((:merge! adapters))))
  ;; note: no :surface! call on the dirty-blocked path at all
  nil)

(defn- non-vacuity-check-silent-block []
  (let [overlap-scenario {:behind 22 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"} :merge-success? true}
        surface-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :dirty-paths! (fn [] #{"seed.txt"})
                  :merge-changed-paths! (fn [] #{"seed.txt"})
                  :merge! (fn [] {:success true})
                  :surface! (fn [_msg] (swap! surface-calls inc))
                  :log! (fn [& _parts] nil)}]
    (mutant-silent-block! (mk-tmp) adapters)
    (if (and (oracle-should-surface? overlap-scenario) (zero? @surface-calls))
      (println "non-vacuity confirmed: invariant 2's oracle would flag a mutant that blocks an overlapping-dirty tree without ever surfacing why")
      (do (println (str "NON-VACUITY FAILURE (silent-block mutant): expected the oracle to require surfacing and the mutant to violate it; surface-calls=" @surface-calls))
          (System/exit 1)))))

(non-vacuity-check-silent-block)

;; Mutant C: a "narrower than necessary" regression mutant for invariant 3 -
;; reconciles only when behind is a multiple of 2, an arbitrary extra
;; restriction with nothing to do with dirt/overlap at all. Applied to a
;; scenario the OLD gate would already have reconciled (behind=5, fully
;; clean tree), this mutant wrongly blocks it - exactly the "narrowing
;; regressed something that used to pass" failure invariant 3 exists to
;; catch, independent of anything to do with the dirty-path machinery.
(defn- mutant-narrower-than-old-gate! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))]
    (when (and (pos? behind) (even? behind))
      ((:merge! adapters)))))

(defn- non-vacuity-check-narrower-than-old-gate []
  (let [clean-odd-behind-scenario {:behind 5 :dirty-paths #{} :merge-changed-paths #{}}
        merge-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 5})
                  :dirty-paths! (fn [] #{})
                  :merge-changed-paths! (fn [] #{})
                  :merge! (fn [] (swap! merge-calls inc) {:success true})
                  :surface! (fn [_msg] nil)
                  :log! (fn [& _parts] nil)}]
    (mutant-narrower-than-old-gate! (mk-tmp) adapters)
    (if (and (oracle-old-gate-should-mutate? clean-odd-behind-scenario) (zero? @merge-calls))
      (println "non-vacuity confirmed: invariant 3's oracle would flag a mutant that regresses a state the old gate already allowed through (merge! did NOT fire when it must)")
      (do (println (str "NON-VACUITY FAILURE (narrower-than-old-gate mutant): expected the old-gate oracle to require reconciling and the mutant to violate it; merge-calls=" @merge-calls))
          (System/exit 1)))))

(non-vacuity-check-narrower-than-old-gate)

;; Mutant D: escalates on the very FIRST tick of a block, ignoring
;; persistence entirely - exactly the bug invariant 4 exists to prevent (an
;; operator escalation must be a SECOND, later signal added only once a
;; block has persisted, never immediate).
(defn- mutant-escalates-immediately! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))
        dirty-paths ((:dirty-paths! adapters))
        merge-changed-paths ((:merge-changed-paths! adapters))
        overlap? (boolean (seq (set/intersection (set dirty-paths) (set merge-changed-paths))))]
    (when (and (pos? behind) overlap?)
      ((:surface! adapters) "blocked")
      ((:escalate! adapters) {:reason "dirty" :behind behind :ticks 1}))))

(defn- non-vacuity-check-escalates-immediately []
  (let [escalate-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :dirty-paths! (fn [] #{"seed.txt"})
                  :merge-changed-paths! (fn [] #{"seed.txt"})
                  :surface! (fn [_msg] nil)
                  :escalate! (fn [_payload] (swap! escalate-calls inc))
                  :log! (fn [& _parts] nil)}
        ;; correct behavior for a FIRST tick with threshold 3: escalate?
        ;; is always false (ticks=1 < 3) - independent restatement, no call
        ;; into next-block-state/escalation-due?.
        oracle-first-tick-escalate? false]
    (mutant-escalates-immediately! (mk-tmp) adapters)
    (if (and (not oracle-first-tick-escalate?) (pos? @escalate-calls))
      (println "non-vacuity confirmed: invariant 4's oracle would flag a mutant that escalates on the very first tick, ignoring persistence (escalate! fired when it must not)")
      (do (println (str "NON-VACUITY FAILURE (escalates-immediately mutant): expected the oracle to forbid escalation on tick 1 and the mutant to violate it; escalate-calls=" @escalate-calls))
          (System/exit 1)))))

(non-vacuity-check-escalates-immediately)

;; Mutant E: never clears persisted state when a block resolves - a stale
;; :escalated flag from an episode that already ended silently survives and
;; suppresses a LATER episode of the SAME reason. Exactly the bug
;; invariant 5 exists to prevent ("never suppressed by a stale flag from an
;; episode that already ended"). Drives the SAME pure primitives
;; production sweep! uses (next-block-state/escalation-due?) directly, but
;; - unlike sweep! - never resets state to {} between episodes, simulating
;; a broken :up-to-date/successful-reconcile branch that forgot to clear.
(defn- mutant-resolve-doesnt-clear-state! [dir threshold]
  (let [escalate-calls (atom 0)
        tick! (fn [reason]
                (let [state (master-main-reconcile-lib/read-state dir)
                      next-state (master-main-reconcile-lib/next-block-state state reason)]
                  (if (master-main-reconcile-lib/escalation-due? next-state threshold)
                    (do (swap! escalate-calls inc)
                        (master-main-reconcile-lib/write-state! dir (assoc next-state :escalated true)))
                    (master-main-reconcile-lib/write-state! dir next-state))))]
    ;; episode 1: two dirty ticks, escalates on the second (threshold 2).
    (tick! "dirty")
    (tick! "dirty")
    ;; BUG: episode 1 resolves here in a real sweep - this mutant never
    ;; clears state, so episode 2 below is wrongly read as a CONTINUATION.
    ;; episode 2: a fresh dirty block, two more ticks - correct behavior
    ;; escalates again on the second tick of THIS episode.
    (tick! "dirty")
    (tick! "dirty")
    @escalate-calls))

(defn- non-vacuity-check-resolve-doesnt-clear-state []
  (let [dir (mk-tmp)
        ;; oracle: two INDEPENDENT episodes, each escalating once on its own
        ;; second tick = 2 total escalate! calls.
        oracle-total-escalate-calls 2
        mutant-escalate-calls (mutant-resolve-doesnt-clear-state! dir 2)]
    (if (and (not= oracle-total-escalate-calls mutant-escalate-calls) (= 1 mutant-escalate-calls))
      (println "non-vacuity confirmed: invariant 5's oracle would flag a mutant that never clears resolved-episode state (episode 2's escalation was wrongly suppressed by episode 1's stale flag)")
      (do (println (str "NON-VACUITY FAILURE (resolve-doesnt-clear-state mutant): expected the oracle to require 2 independent escalations and the mutant to wrongly deliver only 1; got " mutant-escalate-calls))
          (System/exit 1)))))

(non-vacuity-check-resolve-doesnt-clear-state)

;; ── BL-1198: rematch-with-push-first! never discards without pushing first ─

(defn gen-push-scenario [s]
  (let [[push-success? s1] (gen-bool s)]
    [{:push-success? push-success?} s1]))

(defn- push-before-reset-violation [orchestrate! scenario]
  (let [calls (atom [])
        push! (fn [] (swap! calls conj :push) {:success (:push-success? scenario)})
        reset! (fn [] (swap! calls conj :reset) {:success true})]
    (orchestrate! {:push! push! :reset! reset!})
    (cond
      ;; reset! must never fire except immediately after push! was
      ;; attempted and reported failure - any other call sequence
      ;; (including reset with no push at all) is exactly the discard
      ;; this invariant forbids.
      (and (some #{:reset} @calls) (not= [:push :reset] @calls))
      (str "reset fired without a prior failed push: " (pr-str @calls))

      ;; a SUCCESSFUL push must never also call reset - the commit is
      ;; already safely on origin, nothing left to discard. This is the
      ;; scenario-specific half the plain ordering check above cannot see
      ;; on its own ([:push :reset] alone looks like the correct sequence
      ;; even when the push actually succeeded).
      (and (:push-success? scenario) (some #{:reset} @calls))
      (str "reset called despite a successful push: " (pr-str @calls))

      :else true)))

(check-all "bl1198: reset never fires without push being attempted and failing first"
           gen-push-scenario
           (fn [scenario] (push-before-reset-violation master-main-reconcile-lib/rematch-with-push-first! scenario)))

;; Non-vacuity: a mutant that ignores the push outcome entirely (today's
;; pre-fix bug shape - always resets, unconditionally) must be caught.
(defn- mutant-always-resets-regardless-of-push! [{:keys [push! reset!]}]
  (push!)
  (reset!))

(defn- non-vacuity-check-bl1198-push-before-reset []
  (let [violation (push-before-reset-violation mutant-always-resets-regardless-of-push! {:push-success? true})]
    (if (not= true violation)
      (println (str "non-vacuity confirmed: a mutant that always resets regardless of push success is flagged - " violation))
      (do (println "NON-VACUITY FAILURE (bl1198 always-resets mutant): expected a violation, got true")
          (System/exit 1)))))

(non-vacuity-check-bl1198-push-before-reset)

;; ── BL-1248 invariant 1 (coder-authored first, per BL-654): "While the
;;    switch is off, no code path reachable from the handoff daemon cadence
;;    tick can move, reset, or discard a commit reachable from local main -
;;    the switch is a guarantee about refs, not merely a skipped function
;;    call." At this pure-decision layer sweep! is proven against
;;    (:merge! is the SOLE state-mutating adapter, documented at its own
;;    adapter-injected orchestration comment above) that claim reduces to:
;;    merge! NEVER fires when enabled?=false, over the SAME generator
;;    (gen-scenario) invariants 1-3 already use, so every behind/dirty/
;;    merge-changed combination those invariants reach is reached here too
;;    (generator-reach floor, not merely asserted) - including scenarios
;;    that WOULD reconcile with the switch on (oracle-should-mutate? true),
;;    which is exactly the case a guard that merely skips-when-convenient
;;    could get wrong. The real-git half of this claim (a commit genuinely
;;    still reachable by `git merge-base --is-ancestor` after a real tick)
;;    is proven concretely by test_handoffd_master_main_reconcile_wiring.sh
;;    against a real fixture repo with the switch off. ───────────────────
(defn- run-sweep-disabled-with-scenario [{:keys [behind dirty-paths merge-changed-paths merge-success?]}]
  (let [merge-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind behind})
                  :dirty-paths! (fn [] dirty-paths)
                  :merge-changed-paths! (fn [] merge-changed-paths)
                  :merge! (fn [] (swap! merge-calls inc)
                              (if merge-success? {:success true} {:success false :error "conflict"}))
                  :surface! (fn [_msg] nil)
                  :escalate! (fn [_payload] nil)
                  :log! (fn [& _parts] nil)}]
    (master-main-reconcile-lib/sweep! (mk-tmp) single-tick-threshold false adapters)
    {:merge-calls @merge-calls}))

(check-all "master_main_reconcile_lib BL-1248 invariant 1: with the switch off, merge! (the sole state-mutating adapter) never fires - no scenario, including one that WOULD reconcile with the switch on, can move/reset/discard a commit"
  gen-scenario
  (fn [scenario]
    (let [{:keys [merge-calls]} (run-sweep-disabled-with-scenario scenario)]
      (if (pos? merge-calls)
        (str "KILL-SWITCH BREACH: switch is off but merge! fired " merge-calls
             " time(s) for scenario " (pr-str scenario)
             " (oracle-should-mutate?=" (oracle-should-mutate? scenario) ")")
        true))))

;; Non-vacuity: a mutant guard that skips :merge! only when it happens to
;; already be a no-op (behind=0) but calls straight through to :merge!
;; whenever a real reconcile would have fired - i.e. a guard that looks
;; like a kill switch but only ever "skips" the cases that were already
;; harmless, exactly the "merely a skipped function call, not a guarantee"
;; failure shape invariant 1's own wording warns against.
(defn- mutant-guard-only-skips-noop! [dir adapters]
  (let [{:keys [behind]} ((:rev-counts! adapters))
        dirty-paths ((:dirty-paths! adapters))
        merge-changed-paths ((:merge-changed-paths! adapters))
        overlap? (boolean (seq (set/intersection (set dirty-paths) (set merge-changed-paths))))]
    (when (and (pos? behind) (not overlap?))
      ((:merge! adapters)))))

(defn- non-vacuity-check-bl1248-invariant-1 []
  (let [reconcilable-scenario {:behind 22 :dirty-paths #{} :merge-changed-paths #{} :merge-success? true}
        merge-calls (atom 0)
        adapters {:rev-counts! (fn [] {:ahead 0 :behind 22})
                  :dirty-paths! (fn [] #{})
                  :merge-changed-paths! (fn [] #{})
                  :merge! (fn [] (swap! merge-calls inc) {:success true})
                  :surface! (fn [_msg] nil)
                  :log! (fn [& _parts] nil)}]
    (mutant-guard-only-skips-noop! (mk-tmp) adapters)
    (if (and (oracle-should-mutate? reconcilable-scenario) (pos? @merge-calls))
      (println "non-vacuity confirmed: invariant 1 would flag a guard that only skips already-harmless ticks but still merges a genuinely reconcilable one while off")
      (do (println (str "NON-VACUITY FAILURE (bl1248 guard-only-skips-noop mutant): expected a breach, got merge-calls=" @merge-calls))
          (System/exit 1)))))

(non-vacuity-check-bl1248-invariant-1)

;; ── BL-1248 invariant 2 (coder-authored first, per BL-654): "Any config
;;    value other than the explicit affirmative leaves the sweep off -
;;    absent, empty, malformed and unrecognised all fail closed to
;;    disabled, so the dangerous state is never reachable by accident."
;;    Fuzzes the config VALUE (BL-654 generator-reach: the pool is weighted
;;    so the one enabling value, "true", is exactly as likely to be drawn as
;;    any single disabling value - not buried under a wide arbitrary-string
;;    draw that would make the one dangerous case vanishingly rare to
;;    exercise) plus whether the key line is present at all, plus random
;;    surrounding noise lines (other real conf keys), plus surrounding
;;    whitespace - an independent oracle (byte-exact "true", nothing else)
;;    predicts enabled? without calling parse-enabled? itself. ───────────
(def enabled-value-pool ["true" "false" "" "banana" "True" "TRUE" "1" "yes" "true " " true" "true true"])
(def noise-line-pool ["config active_backlog_max_depth 5"
                       "config master_main_reconcile_escalation_threshold 3"
                       "# a comment line"
                       ""])

(defn gen-enabled-conf [s]
  (let [[present? s1] (gen-bool s)
        [value s2] (gen-pick s1 enabled-value-pool)
        [before-lines s3] (gen-subset s2 noise-line-pool)
        [after-lines s4] (gen-subset s3 noise-line-pool)
        key-line (when present? (str "config master_main_reconcile_enabled " value))
        conf-text (clojure.string/join "\n" (concat before-lines (when key-line [key-line]) after-lines))]
    [{:present? present? :value value :conf-text conf-text} s4]))

;; Independent oracle: never calls parse-enabled? - the exact byte-for-byte
;; literal "true" as the sole value token is the ONLY affirmative;
;; everything else, including a value that merely CONTAINS "true"
;; ("true " with trailing space becomes token "true" after whitespace
;; split, so that one IS an affirmative once tokenized - "true true" is NOT,
;; its first token is "true" but it has an extra token, restated below
;; matching the tokenizing contract, not a raw string-equality contract).
(defn- oracle-enabled? [{:keys [present? value]}]
  (and present?
       (= ["true"] (clojure.string/split (clojure.string/trim value) #"\s+"))))

(check-all "master_main_reconcile_lib BL-1248 invariant 2: any config value other than the sole exact token \"true\" fails closed to disabled - absent, empty, malformed and unrecognised all disable"
  gen-enabled-conf
  (fn [{:keys [conf-text] :as scenario}]
    (let [actual (master-main-reconcile-lib/parse-enabled? conf-text)
          expected (oracle-enabled? scenario)]
      (if (not= expected actual)
        (str "FAIL-CLOSED BREACH: conf-text " (pr-str conf-text) " expected enabled?=" expected " got " actual)
        true))))

;; Non-vacuity: a mutant that enables on ANY non-blank value (a substring/
;; truthy check instead of an exact-match check) - exactly the bug
;; invariant 2 exists to prevent (a near-affirmative like "True" or "1"
;; silently reaching the dangerous state).
(defn- mutant-parse-enabled-truthy? [conf-text]
  (boolean
   (when-let [line (some->> (clojure.string/split-lines (or conf-text ""))
                             (filter #(clojure.string/starts-with? % "config master_main_reconcile_enabled"))
                             first)]
     (not (clojure.string/blank? (clojure.string/trim (subs line (count "config master_main_reconcile_enabled"))))))))

(defn- non-vacuity-check-bl1248-invariant-2 []
  (let [scenario {:present? true :value "banana" :conf-text "config master_main_reconcile_enabled banana"}
        actual (mutant-parse-enabled-truthy? (:conf-text scenario))
        expected (oracle-enabled? scenario)]
    (if (not= expected actual)
      (println "non-vacuity confirmed: invariant 2 would flag a mutant that treats any non-blank value as truthy (accepts \"banana\")")
      (do (println (str "NON-VACUITY FAILURE (bl1248 truthy mutant): expected a breach, got expected=" expected " actual=" actual))
          (System/exit 1)))))

(non-vacuity-check-bl1248-invariant-2)

;; ── BL-1310 invariant 1 (coder-authored first, per BL-654): "The reconcile
;;    never runs `git reset --hard origin/main` while local main carries a
;;    commit not reachable from origin/main - the reset's authority is
;;    limited to the ahead=0 case." Encoded over reset-authorized-by-ahead-
;;    count? composed the SAME way handoffd.bb's own refuse-reset-if-local-
;;    ahead! (the required_wiring CONSUMER anchor) composes it: gate first,
;;    raw reset adapter only on authorization - restating that composition
;;    here proves the actual shape production wiring uses, not merely the
;;    predicate in isolation.
;;
;; BL-654 generator-reach: 0 (authorized) and nil (undeterminable) each get
;; real weight, not rare corners - these are the two branches the invariant
;; is actually about. Positive counts vary across small and large so "any
;; positive count refuses" is not proven at just one value.
(defn gen-ahead-count [s]
  (gen-pick s [0 0 0 nil nil nil 1 2 3 5 100 987654321]))

(defn- gated-reset-fires? [reset-authorized-by-ahead-count?-fn ahead]
  (let [calls (atom [])
        raw-reset! (fn [] (swap! calls conj :reset) {:success true})]
    (when (reset-authorized-by-ahead-count?-fn ahead)
      (raw-reset!))
    (boolean (seq @calls))))

(check-all "bl1310 invariant 1: the raw reset adapter fires if and only if ahead is a KNOWN 0"
           gen-ahead-count
           (fn [ahead]
             (let [fired? (gated-reset-fires? master-main-reconcile-lib/reset-authorized-by-ahead-count? ahead)]
               (cond
                 (and (= ahead 0) (not fired?))
                 (str "ahead=0 is genuinely safe (nothing local would be lost) but the reset never fired")

                 (and (not= ahead 0) fired?)
                 (str "reset fired despite ahead=" (pr-str ahead) " - a local-ahead or undeterminable count was discarded")

                 :else true))))

;; Non-vacuity: a mutant that ignores ahead entirely and always resets -
;; exactly today's pre-fix bug shape (every guard shipped so far narrows
;; WHEN the reset fires, none of them changed WHAT HAPPENS TO THE COMMITS).
(defn- mutant-always-authorized? [_ahead] true)

(defn- non-vacuity-check-bl1310-invariant-1 []
  (let [fired? (gated-reset-fires? mutant-always-authorized? 3)]
    (if fired?
      (println "non-vacuity confirmed: a mutant that always authorises the reset is flagged (ahead=3 still reset)")
      (do (println "NON-VACUITY FAILURE (bl1310 always-authorized mutant): expected the reset to fire, it did not")
          (System/exit 1)))))

(non-vacuity-check-bl1310-invariant-1)

;; ── BL-1310 invariant 2 (coder-authored first, per BL-654): "An
;;    undeterminable ahead-count is never treated as ahead=0: if the
;;    reconcile cannot safely tell whether local main is ahead, it leaves
;;    local main exactly as found and reports why, the same non-destructive
;;    shape :verdict-unavailable already uses." Two distinct claims from
;;    invariant 1 above: (a) nil is classified like a REAL positive ahead-
;;    count, never like 0 (already exercised by invariant 1's own generator,
;;    restated directly here against the oracle below for its own
;;    independent proof), and (b) the refusal is always LOUD - a real report
;;    string naming this ticket, never a silent no-op indistinguishable from
;;    "nothing to do".
(defn- oracle-never-guesses-safe? [ahead]
  ;; Independent restatement: authorized iff ahead is the literal integer 0
  ;; - nil, and every other value, refuse. Never calls reset-authorized-by-
  ;; ahead-count? itself.
  (identical? 0 ahead))

(check-all "bl1310 invariant 2: an undeterminable ahead-count is classified exactly like a real positive one (refuse) - never guessed safe like ahead=0"
           gen-ahead-count
           (fn [ahead]
             (let [actual (master-main-reconcile-lib/reset-authorized-by-ahead-count? ahead)
                   expected (oracle-never-guesses-safe? ahead)]
               (if (not= expected actual)
                 (str "ahead=" (pr-str ahead) " expected authorized?=" expected " got " actual)
                 true))))

(check-all "bl1310 invariant 2: the refusal always reports why, the same non-destructive shape :verdict-unavailable already uses (names this ticket, stays within the 80-char note budget)"
           (fn [s] (gen-pick s [0 1 2 3 100 987654321]))
           (fn [behind]
             (let [msg (master-main-reconcile-lib/surface-message {:behind behind :reason :local-ahead-refused})]
               (cond
                 (not (string? msg)) (str "no report produced for behind=" behind " - a silent refusal is indistinguishable from nothing to do")
                 (not (clojure.string/includes? msg "BL-1310")) (str "report does not name BL-1310: " (pr-str msg))
                 (not (clojure.string/includes? msg "not reset")) (str "report does not say no reset happened: " (pr-str msg))
                 (> (count msg) 80) (str "report exceeds the 80-char note budget: " (pr-str msg))
                 :else true))))

;; Non-vacuity: a mutant surface-message that silently falls back to no
;; report at all for this reason (the exact shape a forgotten `case` branch
;; would take, given surface-message's own no-default `case`).
(defn- mutant-surface-message-drops-local-ahead [reason]
  (when-not (= reason :local-ahead-refused) "some other report"))

(defn- non-vacuity-check-bl1310-invariant-2 []
  (let [msg (mutant-surface-message-drops-local-ahead :local-ahead-refused)]
    (if (nil? msg)
      (println "non-vacuity confirmed: a mutant that drops the :local-ahead-refused report is flagged (nil, not a string)")
      (do (println "NON-VACUITY FAILURE (bl1310 dropped-report mutant): expected nil, got a report")
          (System/exit 1)))))

(non-vacuity-check-bl1310-invariant-2)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "master_main_reconcile_lib property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
