#!/usr/bin/env bb
;; BL-630: PROPERTY test over push_sweep_lib.bb, covering the ticket's own
;; declared invariant (coder-authored first, per BL-654):
;;
;;   "No handoffd tick ever pushes a `main` tip that lacks QA approval;
;;    every refusal to publish is loud, never silent."
;;
;; Two conjuncts, checked against an INDEPENDENT oracle (a fresh restatement
;; of the qa-gate rule, not a call into qa-gate-decision itself - same
;; posture as ambulance_lib_property_runner.bb's own P1):
;;   (a) soundness - whenever the oracle says this tip lacks QA approval,
;;       sweep! never actually attempts a push.
;;   (b) loudness  - whenever the oracle says this tip lacks QA approval,
;;       sweep! always logs a distinct qa-refused line - never silently
;;       withholds the push without saying why.
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)" - BL-472 tracks pinning real
;; mutation/property tooling for .bb scripts, deliberately deferred, not
;; wired today): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent. This file follows the property-test precedent this
;; repo already established for .bb code instead (expedite_lib_property_runner.bb,
;; ambulance_lib_property_runner.bb) - a hand-rolled seeded generator in the
;; same swarmforge/scripts/test/ suite that is the actual enforced gate for
;; .bb scripts, per that engineering-article note.

(ns push-sweep-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "push-sweep-lib-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(def retry-cfg {:max-push-attempts 3 :max-alarm-attempts 3
                :backoff-base-ms 1000 :backoff-max-ms 8000})

;; ── seeded generator (identical LCG shape to ambulance_lib_property_runner.bb) ──

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; Small alphabet, deliberately mixing bookkeeping and non-bookkeeping paths
;; so BOTH "every offending commit is bookkeeping-only" and "at least one
;; touches something else" are common, not vanishingly rare - the recorded
;; generator-weighting lesson (a uniform draw over a wide alphabet makes the
;; interesting collision case rare while looking green).
(def bookkeeping-paths ["backlog/active/BL-1.yaml" "docs/how-to/x.md" "swarmforge/scripts/y.bb"])
(def non-bookkeeping-paths ["extension/src/foo.ts" "README.md"])
(def all-paths (into bookkeeping-paths non-bookkeeping-paths))

(defn gen-changed-paths [s]
  (let [[n s1] (gen-int s 3)] ; 0..2 paths
    (reduce (fn [[acc sx] _]
              (let [[p sy] (gen-pick sx all-paths)] [(conj acc p) sy]))
            [[] s1] (range n))))

;; BL-630 bounces (architect, 2026-07-30): :merge? and :changed-paths are
;; generated independently and on equal footing with every other
;; bool/path combination, so BOTH the trivial-merge branch (:merge? true,
;; empty paths - exempt) and the content-bearing-merge branch (:merge?
;; true, non-empty paths - scrutinized like any other commit, bounce #2)
;; are exercised as often as any other case, not a rare corner (BL-654
;; generator-reach: weight it in, don't hope for it).
(defn gen-ahead-commit [s idx]
  (let [[qa-ancestor? s1] (gen-bool s)
        [paths s2] (gen-changed-paths s1)
        [merge? s3] (gen-bool s2)]
    [{:sha (str "sha" idx) :qa-ancestor? qa-ancestor? :changed-paths paths :merge? merge?} s3]))

(defn gen-ahead-commits [s]
  (let [[n s1] (gen-int s 4)] ; 0..3 commits
    (reduce (fn [[acc sx] i]
              (let [[c sy] (gen-ahead-commit sx i)] [(conj acc c) sy]))
            [[] s1] (range n))))

(defn gen-scenario [s]
  (let [[qa-ref-exists? s1] (gen-bool s)
        [facts-complete? s2] (gen-bool s1)
        [tip-is-qa-ancestor? s3] (gen-bool s2)
        [ahead-commits s4] (gen-ahead-commits s3)]
    [{:qa-ref-exists? qa-ref-exists?
      :facts-complete? facts-complete?
      :tip-is-qa-ancestor? tip-is-qa-ancestor?
      :ahead-commits ahead-commits}
     s4]))

;; ── independent oracle: a fresh restatement of the qa-gate rule, built
;;    without calling qa-gate-decision itself ──────────────────────────────
(defn- oracle-bookkeeping-only? [paths]
  (and (seq paths)
       (every? (fn [p] (some #(clojure.string/starts-with? p %) ["backlog/" "docs/" "swarmforge/"])) paths)))

;; BL-630 bounce #2: only a TRIVIAL merge (empty combined-diff paths) is
;; exempt from scrutiny - a content-bearing merge (:merge? true with
;; non-empty :changed-paths, e.g. a hand-resolved conflict) is checked like
;; any other commit, same as the real implementation.
(defn- oracle-trivial-merge? [{:keys [merge? changed-paths]}]
  (and merge? (empty? changed-paths)))

(defn oracle-lacks-qa-approval? [{:keys [qa-ref-exists? facts-complete? tip-is-qa-ancestor? ahead-commits]}]
  (cond
    (not facts-complete?) true
    (not qa-ref-exists?) true
    tip-is-qa-ancestor? false
    :else (boolean (some (fn [c]
                           (and (not (oracle-trivial-merge? c))
                                (not (:qa-ancestor? c))
                                (not (oracle-bookkeeping-only? (:changed-paths c)))))
                         ahead-commits))))

(check-all "push_sweep_lib qa-gate invariant: no push without QA approval, every refusal is loud"
  gen-scenario
  (fn [scenario]
    (let [dir (mk-tmp)
          push-calls (atom 0)
          logs (atom [])
          adapters {:rev-counts! (fn [] {:ahead 1 :behind 0})
                    :push! (fn [] (swap! push-calls inc) {:success true})
                    :send-push-alarm! (fn [_] {:success true})
                    :send-divergence-alarm! (fn [_ _] {:success true})
                    :qa-gate-facts! (fn [] scenario)
                    ;; BL-855: this property predates the no-op-merge gate -
                    ;; the harmless "nothing offered" default keeps it out
                    ;; of the way, mirroring approved-qa-gate-facts' own
                    ;; role for the pre-existing sweep! tests.
                    :noop-merge-gate-facts! (fn [] {:facts-complete? true :ahead-commits []})
                    :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}
          _ (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
          expected-refuse? (oracle-lacks-qa-approval? scenario)
          actually-pushed? (pos? @push-calls)
          logged-refusal? (some #(clojure.string/includes? % "qa-refused") @logs)]
      (cond
        (and expected-refuse? actually-pushed?)
        (str "SOUNDNESS VIOLATION: oracle says lacks QA approval but a push was attempted; logs=" (pr-str @logs))

        (and expected-refuse? (not logged-refusal?))
        (str "LOUDNESS VIOLATION: oracle says lacks QA approval but no qa-refused log line was written; logs=" (pr-str @logs))

        (and (not expected-refuse?) (not actually-pushed?))
        (str "OVER-REFUSAL: oracle says QA-approved but no push was attempted; logs=" (pr-str @logs))

        :else true))))

;; ── non-vacuity: this property MUST actually fail against a deliberately
;;    broken implementation, proven here rather than asserted - a property
;;    that can never fail is worth nothing (BL-654's own generator-reach
;;    rule). Simulate "the gate is bypassed entirely" (always pushes,
;;    regardless of qa-gate facts) and confirm THIS runner's own oracle
;;    catches it. ─────────────────────────────────────────────────────────
(defn- non-vacuity-check []
  (let [dir (mk-tmp)
        push-calls (atom 0)
        broken-adapters {:rev-counts! (fn [] {:ahead 1 :behind 0})
                          :push! (fn [] (swap! push-calls inc) {:success true})
                          :send-push-alarm! (fn [_] {:success true})
                          :send-divergence-alarm! (fn [_ _] {:success true})
                          ;; a gate that ALWAYS approves, even for a tip
                          ;; that plainly lacks QA approval - the bug this
                          ;; whole ticket exists to prevent
                          :qa-gate-facts! (fn [] {:qa-ref-exists? true :tip-is-qa-ancestor? true})
                          :noop-merge-gate-facts! (fn [] {:facts-complete? true :ahead-commits []})
                          :log! (fn [& _parts] nil)}
        lacking-approval-scenario {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
                                    :ahead-commits [{:sha "shaX" :qa-ancestor? false :changed-paths ["extension/src/foo.ts"]}]}]
    (push-sweep-lib/sweep! 100000 dir retry-cfg broken-adapters)
    (if (and (oracle-lacks-qa-approval? lacking-approval-scenario) (pos? @push-calls))
      (println "non-vacuity confirmed: a bypassed gate (always-approve adapter) is caught by this property's oracle")
      (do (println "NON-VACUITY FAILURE: the bypassed-gate simulation did not reproduce the bug this property should catch")
          (System/exit 1)))))

(non-vacuity-check)

;; BL-630 hardener pass (QA bounce #3, 2026-07-30): the non-vacuity check
;; above only proves this property catches a FULLY-bypassed gate
;; (always-approve). QA's bounce evidence named a narrower, historically
;; real gap: the check-all loop above calls the REAL push-sweep-lib/
;; qa-gate-decision, which already treats a content-bearing merge (bounce
;; #2's exact defect - `main`/`push_sweep_lib.bb` reintroduced this once
;; already) as non-exempt, correctly - but nothing here PROVES the
;; generator+oracle pairing would actually catch a regression BACK to
;; bounce #2's specific behavior (unconditionally exempting every
;; `:merge? true` sha regardless of its own content), as opposed to merely
;; hoping 500 random draws happen to hit that exact shape. Reproduce
;; bounce #2's decision function verbatim here (a local copy, deliberately
;; NOT `push-sweep-lib/qa-gate-decision` - this is standing in for the
;; historical bug, not the current fix) and prove on the SAME
;; content-bearing-merge scenario that: (a) today's real qa-gate-decision
;; refuses it, and (b) the bounce-#2 shape would NOT have - i.e. this
;; property's generator/oracle pairing is demonstrated, not assumed, to
;; discriminate the two.
(defn- bounce2-buggy-qa-gate-decision
  "Verbatim restatement of the pre-fix (bounce #2) bug: every :merge? true
   sha is treated as content-free and skipped, regardless of :changed-paths."
  [{:keys [qa-ref-exists? tip-is-qa-ancestor? ahead-commits facts-complete?]
    :or {facts-complete? true}}]
  (cond
    (not facts-complete?) {:refuse? true :reason :gather-failed :offending-shas []}
    (not qa-ref-exists?) {:refuse? true :reason :missing-ref :offending-shas []}
    tip-is-qa-ancestor? {:refuse? false :reason nil :offending-shas []}
    :else
    (let [offending (remove #(or (:qa-ancestor? %) (:merge? %)) ahead-commits)
          non-bookkeeping (remove #(push-sweep-lib/commit-bookkeeping-only? (:changed-paths %)) offending)]
      (if (seq non-bookkeeping)
        {:refuse? true :reason :non-qa-ancestor :offending-shas (mapv :sha non-bookkeeping)}
        {:refuse? false :reason nil :offending-shas []}))))

(defn- non-vacuity-check-bounce2 []
  (let [content-bearing-merge-scenario
        {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
         :ahead-commits [{:sha "octopusMergeSha" :qa-ancestor? false :merge? true
                           :changed-paths ["extension/src/hand-resolved-conflict.ts"]}]}
        real-decision (push-sweep-lib/qa-gate-decision content-bearing-merge-scenario)
        buggy-decision (bounce2-buggy-qa-gate-decision content-bearing-merge-scenario)]
    (if (and (:refuse? real-decision) (not (:refuse? buggy-decision)))
      (println "non-vacuity confirmed: today's qa-gate-decision refuses a content-bearing merge that bounce #2's unconditional-merge-exemption would have waved through")
      (do (println (str "NON-VACUITY FAILURE (bounce #2 mutant): expected the real decision to refuse and the buggy one to approve; got real=" (pr-str real-decision) " buggy=" (pr-str buggy-decision)))
          (System/exit 1)))))

(non-vacuity-check-bounce2)

;; ── BL-855: PROPERTY test over push_sweep_lib.bb, covering the ticket's
;;    own 3 declared invariants (coder-authored first, per BL-654):
;;
;;   1. A merge commit that took NONE of what its second parent offered is
;;      never pushed silently: refused and surfaced with its reason,
;;      however genuinely QA-approved its second parent (authorization is
;;      not effect).
;;   2. A merge that legitimately had nothing to take (second parent
;;      already an ancestor, or zero differing paths) is never flagged.
;;   3. The verdict is computed from git objects alone - it never reads
;;      from an adapter fact that stands in for "the working tree changed
;;      this answer" (checked structurally below: noop-merge-decision's
;;      own signature accepts no working-tree input at all, so any
;;      generated scenario - however it varies the dirty-tree stand-in
;;      fact - can never move the verdict).
;;
;; Independent oracle, built without calling noop-landing-merge?/
;; noop-merge-decision themselves - same posture as the BL-630 property
;; above and ambulance_lib_property_runner.bb's own P1. ─────────────────────

;; ── generator: an ahead-commits seq mixing merge and non-merge entries,
;;    with :tree-equals-parent1? and :offered-paths varied independently
;;    and on equal footing (BL-654 generator-reach: the no-op shape - true
;;    AND non-empty offered-paths together - must be as reachable as any
;;    other combination, not a rare corner of a wide independent draw). ────
(def offered-path-pool ["swarmforge/scripts/x.bb" "extension/src/y.ts" "android/app/z.kt"])

(defn gen-offered-paths [s]
  (let [[n s1] (gen-int s 3)] ; 0..2 paths
    (reduce (fn [[acc sx] _]
              (let [[p sy] (gen-pick sx offered-path-pool)] [(conj acc p) sy]))
            [[] s1] (range n))))

(defn gen-noop-ahead-commit [s idx]
  (let [[merge? s1] (gen-bool s)
        [tree-equals-parent1? s2] (gen-bool s1)
        [offered-paths s3] (gen-offered-paths s2)]
    [{:sha (str "noop-sha" idx)
      :second-parent-sha (str "noop-p2-" idx)
      :merge? merge?
      :tree-equals-parent1? tree-equals-parent1?
      :offered-paths offered-paths}
     s3]))

(defn gen-noop-ahead-commits [s]
  (let [[n s1] (gen-int s 4)] ; 0..3 commits
    (reduce (fn [[acc sx] i]
              (let [[c sy] (gen-noop-ahead-commit sx i)] [(conj acc c) sy]))
            [[] s1] (range n))))

;; qa-ancestor?/dirty-tree stand-in facts are generated too (invariant 1 and
;; 3) but noop-merge-decision's own fact shape has nowhere to consult them -
;; they ride along on each ahead-commit only so a mutant that DID start
;; reading them would have something to read.
(defn gen-noop-scenario [s]
  (let [[facts-complete? s1] (gen-bool s)
        [qa-approved-second-parent? s2] (gen-bool s1)
        [dirty-working-tree? s3] (gen-bool s2)
        [ahead-commits s4] (gen-noop-ahead-commits s3)
        ;; Fold the two stand-in facts onto every merge entry, exactly as a
        ;; real CLI fact-gatherer would tag a commit whose second parent
        ;; happens to be QA-approved, or whose paths happen to also be
        ;; dirty in the working tree - neither is a real field
        ;; noop-merge-decision's contract reads (see invariant 3 above).
        ahead-commits' (mapv (fn [c] (assoc c :qa-ancestor? qa-approved-second-parent?
                                             :dirty-working-tree? dirty-working-tree?))
                              ahead-commits)]
    [{:facts-complete? facts-complete? :ahead-commits ahead-commits'} s4]))

;; ── independent oracle: a fresh restatement of the no-op-landing-merge
;;    rule, built without calling noop-landing-merge?/noop-merge-decision.
;;    Deliberately ignores :qa-ancestor?/:dirty-working-tree? (invariants 1
;;    and 3): the real verdict must too. ─────────────────────────────────
(defn- oracle-noop-hit? [{:keys [merge? tree-equals-parent1? offered-paths]}]
  (and merge? tree-equals-parent1? (seq offered-paths)))

(defn oracle-noop-refuse? [{:keys [facts-complete? ahead-commits]}]
  (or (not facts-complete?)
      (boolean (some oracle-noop-hit? ahead-commits))))

(check-all "push_sweep_lib no-op-landing-merge invariant: a total drop is always refused (even QA-approved/dirty-tree), a genuine nothing-to-take is never flagged"
  gen-noop-scenario
  (fn [scenario]
    (let [decision (push-sweep-lib/noop-merge-decision scenario)
          expected-refuse? (oracle-noop-refuse? scenario)]
      (cond
        (and expected-refuse? (not (:refuse? decision)))
        (str "INVARIANT 1 VIOLATION: oracle says a no-op landing merge is present but noop-merge-decision did not refuse; decision=" (pr-str decision))

        (and (not expected-refuse?) (:refuse? decision))
        (str "INVARIANT 2 VIOLATION: oracle says nothing was silently dropped but noop-merge-decision refused anyway (cries wolf); decision=" (pr-str decision))

        :else true))))

;; ── non-vacuity: prove this property actually fails against a
;;    deliberately broken implementation (BL-654's own generator-reach
;;    rule - a property that can never fail is worth nothing). Simulate
;;    the pre-fix bug directly: a decision function that unconditionally
;;    treats every :merge? true commit as trivial/exempt, exactly like
;;    qa-gate-decision's own trivial-merge? exemption already does for
;;    combined-diff - the exact shape that let f28a84ad's empty combined
;;    diff slip through unscrutinized. ────────────────────────────────────
(defn- bug-shaped-noop-merge-decision
  "Verbatim restatement of the bug this ticket exists to prevent: treats
   EVERY merge commit as exempt (mirrors qa-gate-decision's own
   trivial-merge? exemption, which is exactly what let f28a84ad's empty
   combined diff pass unscrutinized)."
  [{:keys [facts-complete?] :or {facts-complete? true}}]
  (if-not facts-complete?
    {:refuse? true :reason :gather-failed :offending []}
    {:refuse? false :reason nil :offending []}))

(defn- non-vacuity-check-noop-merge []
  (let [f28a84ad-shaped-scenario
        {:facts-complete? true
         :ahead-commits [{:sha "f28a84ad" :merge? true :second-parent-sha "11ae7ac3"
                           :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))}]}
        real-decision (push-sweep-lib/noop-merge-decision f28a84ad-shaped-scenario)
        buggy-decision (bug-shaped-noop-merge-decision f28a84ad-shaped-scenario)]
    (if (and (:refuse? real-decision) (not (:refuse? buggy-decision)))
      (println "non-vacuity confirmed: noop-merge-decision refuses the f28a84ad-shaped no-op merge that an unconditional merge-exemption would have waved through")
      (do (println (str "NON-VACUITY FAILURE (BL-855 no-op-merge mutant): expected the real decision to refuse and the buggy one to approve; got real=" (pr-str real-decision) " buggy=" (pr-str buggy-decision)))
          (System/exit 1)))))

(non-vacuity-check-noop-merge)

;; ── non-vacuity, invariant 3: prove the generator/oracle pairing would
;;    actually catch a mutant that let a working-tree stand-in flag flip
;;    the verdict, not merely hope 500 random draws happen to hit that
;;    shape (same posture as the BL-630 property's own bounce #2 check
;;    above). A no-op landing merge whose :dirty-working-tree? happens to
;;    be true must still refuse. ─────────────────────────────────────────
(defn- dirty-tree-swayed-noop-merge-decision
  "A mutant that lets a working-tree stand-in flag suppress the verdict -
   exactly the bug invariant 3 forbids: the shared, chronically-dirty,
   hot-synced master checkout must never change the answer."
  [{:keys [ahead-commits facts-complete?] :or {facts-complete? true}}]
  (if-not facts-complete?
    {:refuse? true :reason :gather-failed :offending []}
    (let [hits (filter (fn [c] (and (push-sweep-lib/noop-landing-merge? c)
                                     (not (:dirty-working-tree? c))))
                        ahead-commits)]
      (if (seq hits)
        {:refuse? true :reason :noop-landing-merge :offending (mapv :sha hits)}
        {:refuse? false :reason nil :offending []}))))

(defn- non-vacuity-check-dirty-tree []
  (let [dirty-tree-noop-scenario
        {:facts-complete? true
         :ahead-commits [{:sha "f28a84ad" :merge? true :second-parent-sha "11ae7ac3"
                           :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))
                           :dirty-working-tree? true}]}
        real-decision (push-sweep-lib/noop-merge-decision dirty-tree-noop-scenario)
        mutant-decision (dirty-tree-swayed-noop-merge-decision dirty-tree-noop-scenario)]
    (if (and (:refuse? real-decision) (not (:refuse? mutant-decision)))
      (println "non-vacuity confirmed: noop-merge-decision refuses a no-op landing merge regardless of a dirty-working-tree stand-in flag, unlike a mutant that lets it suppress the verdict")
      (do (println (str "NON-VACUITY FAILURE (BL-855 dirty-tree mutant): expected the real decision to refuse and the mutant to approve; got real=" (pr-str real-decision) " mutant=" (pr-str mutant-decision)))
          (System/exit 1)))))

(non-vacuity-check-dirty-tree)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "push_sweep_lib qa-gate property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
