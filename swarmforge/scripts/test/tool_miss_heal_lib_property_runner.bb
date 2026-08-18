#!/usr/bin/env bb
;; PROPERTY test over tool_miss_heal_lib.bb, covering BL-913's own 2
;; generatively-testable declared invariants (coder-authored first, per
;; BL-654):
;;
;;   1. "Exactly one healed re-run per miss: no classification path produces
;;      a second retry, and a failure outside the recoverable classes is
;;      never re-run at all."
;;   3. "When a heal succeeds the model receives only the healed result;
;;      when it does not, the model receives the real failure exactly once -
;;      never both."
;;
;; Invariant 2 ("the pinned environment is derived from the role's own
;; worktree, never from the cwd the process happened to inherit") admits no
;; useful generative encoding of its own: healed-command/build-healing-
;; wrapper-command take pinned-worktree as an explicit parameter and never
;; read any ambient cwd/env inside this module (grep tool_miss_heal_lib.bb
;; for `fs/cwd`/`System/getProperty "user.dir"` - absent), so "derived from
;; the explicit argument, never ambient state" is a property of the
;; function's own signature, not something a randomized generator adds
;; power to prove beyond the example test in tool_miss_heal_lib_test_runner.bb
;; ("build-healing-wrapper-command: embeds the original command" and the
;; end-to-end wrong-cwd/wrong-surface cases, which exercise real cd targets).
;;
;; Runs the REAL generated bash wrapper against a tiny scripted fixture per
;; scenario (never the real git/npm/node this ticket's classes are named
;; after) - the wrapper's own correctness IS whether real bash behaves this
;; way, so a fake-adapter layer would prove nothing about the actual
;; product.

(ns tool-miss-heal-lib-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 150))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "tool-miss-heal-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── seeded generator (identical LCG shape to master_main_reconcile_lib_
;;    property_runner.bb / push_sweep_lib_property_runner.bb) ─────────────
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
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

;; BL-654 generator-reach: every one of the 5 outcomes (succeeds, the 3
;; recoverable classes, real-failure) is drawn with equal probability, and
;; each recoverable class independently draws whether its OWN healed re-run
;; succeeds or fails the same way again (scenario 03's own case) - so both
;; "heal fixes it" and "heal doesn't help, stop anyway" are common, not
;; edge cases the generator only stumbles into.
(def OUTCOME-POOL [:succeeds :wrong-cwd :wrong-surface :missing-root-argv :real-failure])
(def HEAL-OUTCOME-POOL [:succeeds :fails-again])
(def RECOVERABLE-OUTCOMES #{:wrong-cwd :wrong-surface :missing-root-argv})

;; A representative trigger text per class - real stderr shapes a genuine
;; miss of that class would produce, each one classify-miss's own
;; MISS-CLASS-PATTERNS actually matches (never a hand-invented string that
;; only looks plausible).
(def CLASS-TRIGGER-TEXT
  {:wrong-cwd "fatal: not a git repository (or any of the parent directories): .git"
   :wrong-surface "npm error code ENOENT"
   :missing-root-argv "Usage: node cli.js <project-root>"
   :real-failure "1 test failed: expected 2, got 3"})

(defn gen-scenario [s]
  (let [[outcome s1] (gen-pick s OUTCOME-POOL)]
    (if (contains? RECOVERABLE-OUTCOMES outcome)
      (let [[heal-outcome s2] (gen-pick s1 HEAL-OUTCOME-POOL)]
        [{:outcome outcome :heal-outcome heal-outcome} s2])
      [{:outcome outcome :heal-outcome nil} s1])))

;; A fixture script that counts its own invocations to `counter-path` and
;; behaves per the scenario: invocation 1 per `outcome`, invocation 2 (only
;; ever reached for a recoverable outcome) per `heal-outcome`. Ignores its
;; own cwd deliberately - the cd-based redirection healed-command performs
;; is already proven correct end to end in tool_miss_heal_lib_test_runner.bb;
;; this property is about the WRAPPER's own call-counting and result-
;; propagation, independent of which specific healed-command variant fires.
(defn- write-fixture! [path {:keys [outcome heal-outcome]} counter-path]
  (spit path
        (str "#!/usr/bin/env bash\n"
             "n=$(( $(cat " counter-path " 2>/dev/null || echo 0) + 1 ))\n"
             "echo $n > " counter-path "\n"
             "if [ \"$n\" = 1 ]; then\n"
             (if (= outcome :succeeds)
               "  printf 'FIRST-OK'; exit 0\n"
               (str "  echo " (tool-miss-heal-lib/shell-quote (get CLASS-TRIGGER-TEXT outcome)) " >&2\n"
                    "  exit 7\n"))
             ;; The n=2 branch is only ever REACHED at runtime for a
             ;; recoverable outcome (invocation count 1 for :succeeds/
             ;; :real-failure) - still generated unconditionally so the
             ;; script text itself is always valid; unreachable-at-runtime
             ;; classes fall back to a placeholder rather than crashing the
             ;; generator on a CLASS-TRIGGER-TEXT lookup miss.
             "else\n"
             (if (= heal-outcome :succeeds)
               "  printf 'HEALED-OK'; exit 0\n"
               (str "  echo " (tool-miss-heal-lib/shell-quote (or (get CLASS-TRIGGER-TEXT outcome) "unreachable")) " >&2\n"
                    "  exit 7\n"))
             "fi\n"))
  (.setExecutable (fs/file path) true))

(defn run-scenario [scenario]
  (let [tmp (mk-tmp)
        ;; wrong-surface's own healed-command cd's into <pinned-worktree>/
        ;; extension - a real swarm worktree always has one; this fixture's
        ;; pinned worktree must too, or the heal itself fails on a `cd` to a
        ;; directory that was never meant to exist.
        _ (fs/create-dir (fs/path tmp "extension"))
        script (str tmp "/fixture.sh")
        counter (str tmp "/n")
        _ (write-fixture! script scenario counter)
        wrapper (tool-miss-heal-lib/build-healing-wrapper-command (str "bash " script) tmp)
        {:keys [out exit]} (process/sh ["bash" "-c" wrapper])
        invocations (try (Long/parseLong (str/trim (slurp counter))) (catch Exception _ 0))]
    {:out out :exit exit :invocations invocations}))

;; ── independent oracles: fresh restatements of the expected behaviour,
;;    built without calling build-healing-wrapper-command/classify-miss
;;    themselves ────────────────────────────────────────────────────────
(defn- oracle-invocation-count [{:keys [outcome]}]
  (if (contains? RECOVERABLE-OUTCOMES outcome) 2 1))

(defn- oracle-final-marker [{:keys [outcome heal-outcome]}]
  (cond
    (= outcome :succeeds) "FIRST-OK"
    (= outcome :real-failure) (get CLASS-TRIGGER-TEXT :real-failure)
    (= heal-outcome :succeeds) "HEALED-OK"
    :else (get CLASS-TRIGGER-TEXT outcome)))

(defn- oracle-final-exit [{:keys [outcome heal-outcome]}]
  (if (or (= outcome :succeeds) (and (contains? RECOVERABLE-OUTCOMES outcome) (= heal-outcome :succeeds)))
    0
    7))

;; ── invariant 1 ────────────────────────────────────────────────────────
(check-all
 "tool_miss_heal_lib invariant 1: invocation count matches the oracle exactly - never a second retry, never a retry for real-failure"
 gen-scenario
 (fn [scenario]
   (let [{:keys [invocations]} (run-scenario scenario)
         expected (oracle-invocation-count scenario)]
     (or (= invocations expected)
         (str "expected " expected " invocation(s), got " invocations)))))

;; ── invariant 3 ────────────────────────────────────────────────────────
(check-all
 "tool_miss_heal_lib invariant 3: the model receives exactly the oracle's own final marker and exit code - never a mix of both attempts"
 gen-scenario
 (fn [scenario]
   (let [{:keys [out exit]} (run-scenario scenario)
         expected-marker (oracle-final-marker scenario)
         expected-exit (oracle-final-exit scenario)]
     (cond
       (not= out expected-marker) (str "expected output " (pr-str expected-marker) ", got " (pr-str out))
       (not= exit expected-exit) (str "expected exit " expected-exit ", got " exit)
       (and (not= (:outcome scenario) :succeeds) (str/includes? out "FIRST-OK"))
       "output must never contain the first attempt's own marker once a retry happened"
       :else true))))

;; ── non-vacuity (BL-654): a "double retry" mutant - independent `if`
;;    statements per class instead of an if/elif chain, so a healed re-run
;;    whose own output still matches the SAME class's pattern (scenario 03)
;;    gets retried a SECOND time. This is exactly the bug invariant 1 exists
;;    to prevent. ─────────────────────────────────────────────────────────
(defn mutant-double-retry-wrapper [original-command pinned-worktree]
  (let [pattern (tool-miss-heal-lib/shell-quote (get (into {} tool-miss-heal-lib/MISS-CLASS-PATTERNS) :wrong-cwd))
        healed (tool-miss-heal-lib/healed-command :wrong-cwd original-command pinned-worktree)]
    (str "__sfh_out=$(" original-command " 2>&1); __sfh_ec=$?\n"
         "if [ $__sfh_ec -ne 0 ] && printf '%s' \"$__sfh_out\" | grep -qiE " pattern "; then\n"
         "  __sfh_out=$(" healed " 2>&1); __sfh_ec=$?\n"
         "fi\n"
         "if [ $__sfh_ec -ne 0 ] && printf '%s' \"$__sfh_out\" | grep -qiE " pattern "; then\n"
         "  __sfh_out=$(" healed " 2>&1); __sfh_ec=$?\n"
         "fi\n"
         "printf '%s' \"$__sfh_out\"\nexit $__sfh_ec\n")))

(let [tmp (mk-tmp)
      script (str tmp "/fixture.sh")
      counter (str tmp "/n")
      _ (write-fixture! script {:outcome :wrong-cwd :heal-outcome :fails-again} counter)
      wrapper (mutant-double-retry-wrapper (str "bash " script) tmp)]
  (process/sh ["bash" "-c" wrapper])
  (let [invocations (try (Long/parseLong (str/trim (slurp counter))) (catch Exception _ 0))]
    (if (= invocations 3)
      (println "non-vacuity confirmed: invariant 1's own oracle would flag a mutant that retries a second time when the heal fails the same way again")
      (swap! failures conj (str "FAIL non-vacuity: expected the double-retry mutant fixture to actually invoke 3 times, got " invocations)))))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
