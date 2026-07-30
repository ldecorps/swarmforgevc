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

;; BL-630 bounce (architect, 2026-07-30): a merge commit (:merge? true) is
;; never itself offending, however its own :qa-ancestor?/:changed-paths
;; read - generated on equal footing with every other bool/path combination
;; so the merge-transparent branch is exercised as often as any other, not
;; a rare corner (BL-654 generator-reach: weight it in, don't hope for it).
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

(defn oracle-lacks-qa-approval? [{:keys [qa-ref-exists? facts-complete? tip-is-qa-ancestor? ahead-commits]}]
  (cond
    (not facts-complete?) true
    (not qa-ref-exists?) true
    tip-is-qa-ancestor? false
    :else (boolean (some (fn [{:keys [qa-ancestor? changed-paths merge?]}]
                           (and (not merge?) (not qa-ancestor?) (not (oracle-bookkeeping-only? changed-paths))))
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
                          :log! (fn [& _parts] nil)}
        lacking-approval-scenario {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
                                    :ahead-commits [{:sha "shaX" :qa-ancestor? false :changed-paths ["extension/src/foo.ts"]}]}]
    (push-sweep-lib/sweep! 100000 dir retry-cfg broken-adapters)
    (if (and (oracle-lacks-qa-approval? lacking-approval-scenario) (pos? @push-calls))
      (println "non-vacuity confirmed: a bypassed gate (always-approve adapter) is caught by this property's oracle")
      (do (println "NON-VACUITY FAILURE: the bypassed-gate simulation did not reproduce the bug this property should catch")
          (System/exit 1)))))

(non-vacuity-check)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "push_sweep_lib qa-gate property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
