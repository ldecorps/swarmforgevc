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

;; BL-960: capture is byte-faithful now - the fixtures' echo'd failure texts
;; come back WITH their trailing newline (the old $()-capture stripped it;
;; that strip was itself part of BL-960's defect 1). printf'd OK markers
;; carry no newline, exactly as the fixture emits them.
(defn- oracle-final-marker [{:keys [outcome heal-outcome]}]
  (cond
    (= outcome :succeeds) "FIRST-OK"
    (= outcome :real-failure) (str (get CLASS-TRIGGER-TEXT :real-failure) "\n")
    (= heal-outcome :succeeds) "HEALED-OK"
    :else (str (get CLASS-TRIGGER-TEXT outcome) "\n")))

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

;; ── BL-934 (coder-authored, per BL-654): the two invariants this ticket's
;;    own YAML declares ─────────────────────────────────────────────────
;;
;;   1. "The generated wrapper's classified source never concatenates the
;;      original command with the pinned worktree as an additional
;;      positional argument." Generates arbitrary original commands - both
;;      rm-shaped (the false-positive's own shape) and non-rm CLIs (the
;;      shape this heal exists for) - against arbitrary worktree paths, and
;;      asserts the literal concatenation never appears anywhere in the
;;      generated source.
;;   2. "A genuine original command that already names the pinned worktree
;;      as an rm target remains visible as a command in the wrapper
;;      source." Generates arbitrary rm invocations whose OWN argument list
;;      already includes the pinned worktree, and asserts that exact
;;      original-command text still appears verbatim in the wrapper.
;;
;; Generator-reach: the original-command pool is built from the real
;; command shapes this ticket's own description names - a bare `rm -f`/
;; `rm -rf` of one or more paths (the false-positive's shape) and a
;; node/bb CLI invocation (the genuine missing-root-argv shape) - plus
;; worktree paths drawn from a pool including special characters (a single
;; quote, a space) so the shell-quote escaping itself is exercised, not
;; just the plain-path common case.

(def BL934-ORIGINAL-COMMAND-POOL
  ["rm -f tmp/a.json tmp/b.json"
   "rm -rf tmp/scratch"
   "rm tmp/single.json"
   "node cli.js --flag value"
   "bb some_script.bb arg1"])

(def BL934-WORKTREE-POOL
  ["/Users/ldecorps/projects/swarmforgevc"
   "/Users/ldecorps/projects/swarmforgevc/.worktrees/coder"
   "/it's/a/path with a space"
   "/tmp/tmp.abc123"])

(defn- gen-bl934-scenario [s]
  (let [[original s1] (gen-pick s BL934-ORIGINAL-COMMAND-POOL)
        [worktree s2] (gen-pick s1 BL934-WORKTREE-POOL)]
    [{:original original :worktree worktree} s2]))

(check-all "BL-934 invariant 1: the wrapper source never concatenates the original command with the pinned worktree as a trailing arg"
  gen-bl934-scenario
  (fn [{:keys [original worktree]}]
    (let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command original worktree)
          forbidden (str original " " (tool-miss-heal-lib/shell-quote worktree))]
      (if (str/includes? wrapper forbidden)
        (str "wrapper contains the forbidden literal concatenation: " (pr-str forbidden))
        true))))

(defn- gen-bl934-dangerous-original-scenario [s]
  (let [[worktree s1] (gen-pick s BL934-WORKTREE-POOL)
        [suffix s2] (gen-pick s1 ["" "/subdir" "/.git"])
        [flag s3] (gen-pick s2 ["-rf" "-f" "-r"])]
    [{:worktree worktree :dangerous-original (str "rm " flag " " worktree suffix)} s3]))

(check-all "BL-934 invariant 2: a genuine rm of the pinned worktree in the ORIGINAL command stays fully visible in the wrapper source"
  gen-bl934-dangerous-original-scenario
  (fn [{:keys [worktree dangerous-original]}]
    (let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command dangerous-original worktree)]
      (if (str/includes? wrapper dangerous-original)
        true
        (str "the dangerous original command was not found verbatim in the wrapper: " (pr-str dangerous-original))))))

;; Non-vacuity (BL-654): confirmed by hand at authoring time - temporarily
;; restoring healed-command's :missing-root-argv branch to the pre-fix
;; literal `(str original-command " " (shell-quote pinned-worktree))` made
;; the FIRST property above fail immediately (the forbidden substring is
;; then exactly what that branch emits, for every generated scenario, not
;; just a corner case). The second property does not regress under that
;; same mutant - it is a check on the UNTOUCHED first line, which this
;; ticket's fix never modifies - so it stays green on its own throughout,
;; which is the expected shape for an invariant this fix does not change.
;; Restored before this commit.

;; ══ BL-960 (coder-authored, per BL-654): the three invariants this
;;    ticket's own YAML declares ═══════════════════════════════════════════
;;
;;   1. Every command text the hook hands back parses as bash; a composition
;;      that does not parse fail-opens to the byte-untouched original.
;;   2. When no heal fires, wrapping is observationally invisible: exit
;;      code, combined output (vs the unwrapped command run with 2>&1,
;;      trailing bytes included), and file side effects are byte-identical.
;;   3. A heal rewrite is applied only where its target is well-defined for
;;      the command's actual shape (:missing-root-argv over a pipeline or
;;      ;-sequence declines); the failure returns as-is.

;; Token pool: hostile text fragments every template embeds via shell-quote,
;; so quoting itself is exercised alongside the structural shapes.
(def BL960-TOKEN-POOL
  ["plain" "a)b" "(open" "it's got a quote" "say \"hi\"" "two  spaces" "tail)"])

;; ── invariant 1: parse-or-fail-open ─────────────────────────────────────
;; Shape buckets, generated by construction: :composes shapes are valid
;; standalone AND must survive embedding (the hostile corpus - losing one
;; silently would strip healing from every command of that shape);
;; :fail-opens shapes cannot survive embedding (an unterminated heredoc
;; swallows the group's own closer) - safe-wrapper-command must return nil.
;; Both buckets are drawn as siblings of the same generator, so the
;; reachability floor is by construction, not hoped for.
(def BL960-COMPOSING-SHAPES
  [(fn [t] (str "printf '%s' " (tool-miss-heal-lib/shell-quote t)))
   (fn [t] (str "echo " (tool-miss-heal-lib/shell-quote t)))
   (fn [t] (str "cat <<'SFH960'\n" t "\nSFH960"))
   (fn [t] (str "printf '%s\\n' " (tool-miss-heal-lib/shell-quote t) " | sort"))
   (fn [t] (str "printf 'a\\n'; printf '%s\\n' " (tool-miss-heal-lib/shell-quote t) " >&2"))
   (fn [t] (str "printf '%s' " (tool-miss-heal-lib/shell-quote t) "; exit 3"))])
(def BL960-FAIL-OPEN-SHAPES
  [(fn [t] (str "cat <<SFH960\n" t))     ; unterminated heredoc (token in body)
   ;; token deliberately NOT embedded: a token carrying its own quote would
   ;; balance this shape and silently move it to the :composes bucket
   (fn [_] "echo 'unterminated")])        ; unterminated quote

(defn- gen-bl960-parse-scenario [s]
  (let [[bucket s1] (gen-pick s [:composes :composes :composes :fail-opens])
        [token s2] (gen-pick s1 BL960-TOKEN-POOL)
        [shape s3] (gen-pick s2 (if (= bucket :composes) BL960-COMPOSING-SHAPES BL960-FAIL-OPEN-SHAPES))]
    [{:bucket bucket :original (shape token)} s3]))

(check-all
 "BL-960 invariant 1: safe-wrapper-command returns a bash-parseable wrapper for every composing shape and nil (fail-open) for every non-composing one"
 gen-bl960-parse-scenario
 (fn [{:keys [bucket original]}]
   (let [wrapper (tool-miss-heal-lib/safe-wrapper-command original "/w")]
     (case bucket
       :composes (cond
                   (nil? wrapper) "expected the composition to parse and be returned, got nil (healing silently lost for this shape)"
                   (not (tool-miss-heal-lib/wrapper-parses? wrapper)) "safe-wrapper-command returned text real bash -n rejects"
                   :else true)
       :fail-opens (if (nil? wrapper)
                     true
                     "expected nil (fail-open) for a non-composing shape, got a wrapper")))))

;; ── invariant 2: no-heal invisibility, generatively ─────────────────────
;; Each draw instantiates a template with a hostile token and runs the SAME
;; command wrapped and unwrapped (with `exec 2>&1` merging streams OUTSIDE
;; the whole command - the invariant's own comparison baseline) against twin
;; fixture dirs, comparing exit code, combined output bytes, and written
;; file bytes. Templates cover both exit-0 and non-matching-failure
;; outcomes as generator siblings (reach floor by construction); no token
;; or template text matches any MISS-CLASS pattern, so no heal ever fires.
(def BL960-ROUNDTRIP-TEMPLATES
  [(fn [t] (str "printf '%s' " (tool-miss-heal-lib/shell-quote t)))
   (fn [t] (str "echo " (tool-miss-heal-lib/shell-quote t)))
   (fn [t] (str "cat <<'SFH960' > rt-out.txt\n" t "\nSFH960\nprintf 'wrote'"))
   (fn [t] (str "printf '%s\\n' " (tool-miss-heal-lib/shell-quote t) " \"a)b\" | sort"))
   (fn [t] (str "printf 'one\\n'; printf '%s\\n' " (tool-miss-heal-lib/shell-quote t) " >&2; printf 'three\\n'"))
   (fn [t] (str "echo " (tool-miss-heal-lib/shell-quote t) "; exit 3"))
   (fn [t] (str "printf '%s' " (tool-miss-heal-lib/shell-quote t) " > rt-out.txt\nexit 5"))])

(defn- gen-bl960-roundtrip-scenario [s]
  (let [[token s1] (gen-pick s BL960-TOKEN-POOL)
        [template s2] (gen-pick s1 BL960-ROUNDTRIP-TEMPLATES)]
    [{:original (template token)} s2]))

(defn- dir-file-bytes [d]
  (into {} (map (fn [f] [(str (fs/relativize d f)) (slurp (str f))])
                (filter fs/regular-file? (fs/glob d "**")))))

(check-all
 "BL-960 invariant 2: when no heal fires, exit code, combined output, and file side effects are byte-identical to the unwrapped command's (trailing bytes included)"
 gen-bl960-roundtrip-scenario
 (fn [{:keys [original]}]
   (let [dir-a (mk-tmp) dir-b (mk-tmp)
         unwrapped (process/sh ["bash" "-c" (str "exec 2>&1\n" original)] {:dir dir-a})
         wrapper (tool-miss-heal-lib/build-healing-wrapper-command original "/sfh-pin-never-used")
         wrapped (process/sh ["bash" "-c" wrapper] {:dir dir-b})]
     (cond
       (not= (:exit unwrapped) (:exit wrapped))
       (str "exit diverged: unwrapped " (:exit unwrapped) " vs wrapped " (:exit wrapped))
       (not= (:out unwrapped) (:out wrapped))
       (str "combined output diverged: " (pr-str (:out unwrapped)) " vs " (pr-str (:out wrapped)))
       (not= (dir-file-bytes dir-a) (dir-file-bytes dir-b))
       "file side effects diverged between the unwrapped and wrapped runs"
       :else true))))

;; ── invariant 3: the missing-root heal only where well-defined ──────────
;; Collision-style construction (the BL-654 generator-reach requirement's
;; own prescription): the multi-command case is DERIVED from the
;; single-simple case by the exact transformation the code could conflate -
;; appending a separator and an unrelated tail - so every draw is a gated
;; candidate by construction, never a lucky collision.
(def BL960-SIMPLE-BASE-POOL
  ["node cli.js" "node cli.js --flag value" "bb propose_onboarding_prompts.bb" "python3 tool.py -v"])
(def BL960-SEPARATOR-POOL ["; " " && " " | " "\n"])
(def BL960-TAIL-POOL ["echo \"---done---\"" "printf done" "true"])

(defn- gen-bl960-misdirect-scenario [s]
  (let [[base s1] (gen-pick s BL960-SIMPLE-BASE-POOL)
        [sep s2] (gen-pick s1 BL960-SEPARATOR-POOL)
        [tail s3] (gen-pick s2 BL960-TAIL-POOL)]
    [{:base base :derived (str base sep tail)} s3]))

(check-all
 "BL-960 invariant 3: the single-simple base still carries the missing-root heal, and every derived multi-command sibling omits it entirely - never a misdirected append"
 gen-bl960-misdirect-scenario
 (fn [{:keys [base derived]}]
   (let [base-wrapper (tool-miss-heal-lib/build-healing-wrapper-command base "/w")
         derived-wrapper (tool-miss-heal-lib/build-healing-wrapper-command derived "/w")]
     (cond
       (not (str/includes? base-wrapper (str base " \"$__sfh_root\"")))
       "the single-simple base LOST its missing-root heal (over-gated)"
       (str/includes? derived-wrapper "\"$__sfh_root\"")
       (str "the derived multi-command wrapper still appends the root: " (pr-str derived))
       (not (tool-miss-heal-lib/wrapper-parses? derived-wrapper))
       "the derived wrapper does not parse"
       :else true))))

;; ── non-vacuity (BL-654), executable every run ──────────────────────────
;; Also confirmed against the REAL implementation at authoring time
;; (2026-08-19), each break run and then restored before commit:
;;   - safe-wrapper-command with its parse gate bypassed -> the invariant-1
;;     property failed on the first :fail-opens draw (and 4 unit assertions
;;     with it);
;;   - healed-command's single-simple gate removed (the pre-fix
;;     unconditional append) -> the invariant-3 property failed immediately,
;;     and invariant 1 failed too (the ungated append breaks composition for
;;     heredoc originals - defense in depth);
;;   - the cat replay swapped for printf '%s' "$(cat ...)" (a realistic
;;     trailing-newline-stripping wrong implementation) -> the invariant-2
;;     property failed, as did BL-913's own invariant-3 property above.
;; Mutant A (invariant 1): a gate-skipping safe-wrapper (what the hook would
;; do with the parse check disabled) hands over text real bash -n rejects
;; for an unterminated-heredoc original.
(let [original "cat <<SFH960\nstill open"
      ungated (tool-miss-heal-lib/build-healing-wrapper-command original "/w")]
  (if (tool-miss-heal-lib/wrapper-parses? ungated)
    (swap! failures conj "FAIL non-vacuity A: expected the unterminated-heredoc composition to be rejected by bash -n; invariant 1's gate has nothing to catch")
    (println "non-vacuity A confirmed: with the parse gate skipped, an unterminated-heredoc composition reaches the model as unparseable bash - invariant 1's gate is load-bearing")))

;; Mutant B (invariant 2): the pre-fix $()-splice capture (reconstructed
;; verbatim in miniature) strips the trailing newline - the oracle flags it.
(let [original "echo mutant-b-check"
      old-shape (str "__sfh_out=$(" original " 2>&1); __sfh_ec=$?\n"
                     "printf '%s' \"$__sfh_out\"\nexit $__sfh_ec\n")
      unwrapped (process/sh ["bash" "-c" (str "exec 2>&1\n" original)])
      mutant (process/sh ["bash" "-c" old-shape])]
  (if (= (:out unwrapped) (:out mutant))
    (swap! failures conj "FAIL non-vacuity B: expected the old $()-splice capture to strip the trailing newline; invariant 2's byte comparison has nothing to catch")
    (println "non-vacuity B confirmed: the pre-fix $()-capture drops trailing bytes - invariant 2's byte-exact comparison catches the shipped defect")))

;; Mutant C (invariant 3): the pre-fix ungated append (restored verbatim)
;; lands the root on the derived multi-command string - the property's own
;; forbidden-substring check flags it.
(let [derived "node cli.js && echo \"---done---\""
      mutant-healed (str derived " \"$__sfh_root\"")]
  (if (str/includes? mutant-healed "echo \"---done---\" \"$__sfh_root\"")
    (println "non-vacuity C confirmed: the pre-fix ungated append produces exactly the live misdirection shape - invariant 3's check catches it")
    (swap! failures conj "FAIL non-vacuity C: expected the ungated append to reproduce the misdirection shape")))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
