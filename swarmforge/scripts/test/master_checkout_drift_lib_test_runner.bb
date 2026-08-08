#!/usr/bin/env bb
;; BL-839: TDD runner for master_checkout_drift_lib.bb's pure decision logic
;; - text-scan dependency extraction, the BFS closure, per-file drift
;; classification, verdict aggregation, and alarm text. No real git, no real
;; filesystem - injected in-memory maps only, so every case is deterministic
;; and instant. The real-IO/real-git path (check-master-checkout-drift!) is
;; covered by the property runner and by the acceptance step handlers.

(ns master-checkout-drift-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_checkout_drift_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── extract-load-file-basenames ─────────────────────────────────────────────

(assert= "extracts a single (load-file ...) call's bare filename"
         #{"flow_watchdog_lib.bb"}
         (master-checkout-drift-lib/extract-load-file-basenames
          "(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"flow_watchdog_lib.bb\")))"))

(assert= "extracts every (load-file ...) call across multiple lines"
         #{"handoff_lib.bb" "ambulance_lib.bb"}
         (master-checkout-drift-lib/extract-load-file-basenames
          (str "(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"handoff_lib.bb\")))\n"
               "(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"ambulance_lib.bb\")))\n")))

(assert= "a commented-out load-file line is never treated as a real dependency"
         #{}
         (master-checkout-drift-lib/extract-load-file-basenames
          ";;   (load-file (str (fs/path (fs/parent *file*) \"availability_ledger_lib.bb\")))"))

(assert= "a mix of a real call and a commented-out call extracts only the real one"
         #{"real_dep.bb"}
         (master-checkout-drift-lib/extract-load-file-basenames
          (str ";; (load-file (str (fs/path (fs/parent *file*) \"commented_dep.bb\")))\n"
               "(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"real_dep.bb\")))\n")))

(assert= "content with no load-file calls at all extracts an empty set"
         #{}
         (master-checkout-drift-lib/extract-load-file-basenames "(defn foo [] (+ 1 2))\n"))

(assert= "a variable-based fs/path (no fs/parent/canonicalize) still extracts the filename"
         #{"agent_runtime_lib.bb"}
         (master-checkout-drift-lib/extract-load-file-basenames
          "(load-file (str (fs/path scripts-dir \"agent_runtime_lib.bb\")))"))

;; ── resolve-daemon-executed-paths ───────────────────────────────────────────

(assert= "a single entrypoint with no dependencies resolves to just itself"
         #{"a.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file (fn [_] "(defn foo [])")}))

(assert= "one level of dependency is included"
         #{"a.bb" "b.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file {"a.bb" "(load-file (str (fs/path x \"b.bb\")))"
                       "b.bb" "(defn foo [])"}}))

(assert= "a transitive chain A->B->C is fully resolved"
         #{"a.bb" "b.bb" "c.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file {"a.bb" "(load-file (str (fs/path x \"b.bb\")))"
                       "b.bb" "(load-file (str (fs/path x \"c.bb\")))"
                       "c.bb" "(defn foo [])"}}))

(assert= "a dependency cycle (A loads B, B loads A) terminates and includes both"
         #{"a.bb" "b.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file {"a.bb" "(load-file (str (fs/path x \"b.bb\")))"
                       "b.bb" "(load-file (str (fs/path x \"a.bb\")))"}}))

(assert= "two entrypoints sharing a dependency dedup to one set entry"
         #{"a.bb" "b.bb" "shared.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb" "b.bb"}
           :read-file {"a.bb" "(load-file (str (fs/path x \"shared.bb\")))"
                       "b.bb" "(load-file (str (fs/path x \"shared.bb\")))"
                       "shared.bb" "(defn foo [])"}}))

(assert= "an unreadable entrypoint is still included in the result, contributing no further edges"
         #{"a.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file (fn [_] nil)}))

(assert= "a ticket YAML or scratch file never appears merely because the read-file map contains it - only files actually reached by a load-file edge from the entrypoints are included"
         #{"a.bb"}
         (master-checkout-drift-lib/resolve-daemon-executed-paths
          {:entrypoints #{"a.bb"}
           :read-file {"a.bb" "(defn foo [])"
                       "backlog/active/BL-000.yaml" "id: BL-000"
                       "scratch.txt" "whatever"}}))

;; ── classify-drift ───────────────────────────────────────────────────────────

(assert= "all three readings agree -> :no-drift"
         :no-drift
         (master-checkout-drift-lib/classify-drift
          {:main-content "same" :main-ok? true
           :index-content "same" :index-ok? true
           :worktree-content "same" :worktree-ok? true}))

(assert= "index differs from main (worktree matches index, the incident's own shape) -> :staged-for-reversion"
         :staged-for-reversion
         (master-checkout-drift-lib/classify-drift
          {:main-content "post-fix" :main-ok? true
           :index-content "pre-fix" :index-ok? true
           :worktree-content "pre-fix" :worktree-ok? true}))

(assert= "index matches main but working tree does not -> :uncommitted-edit"
         :uncommitted-edit
         (master-checkout-drift-lib/classify-drift
          {:main-content "same" :main-ok? true
           :index-content "same" :index-ok? true
           :worktree-content "edited" :worktree-ok? true}))

(assert= "main-content read failure -> :unknown, never :no-drift or :drift"
         :unknown
         (master-checkout-drift-lib/classify-drift
          {:main-content nil :main-ok? false
           :index-content "x" :index-ok? true
           :worktree-content "x" :worktree-ok? true}))

(assert= "index-content read failure -> :unknown"
         :unknown
         (master-checkout-drift-lib/classify-drift
          {:main-content "x" :main-ok? true
           :index-content nil :index-ok? false
           :worktree-content "x" :worktree-ok? true}))

(assert= "worktree-content read failure -> :unknown"
         :unknown
         (master-checkout-drift-lib/classify-drift
          {:main-content "x" :main-ok? true
           :index-content "x" :index-ok? true
           :worktree-content nil :worktree-ok? false}))

(assert= "a genuinely empty (but successfully read) file is :no-drift, not confused with a read failure"
         :no-drift
         (master-checkout-drift-lib/classify-drift
          {:main-content "" :main-ok? true
           :index-content "" :index-ok? true
           :worktree-content "" :worktree-ok? true}))

(assert= "when BOTH index and worktree differ from main, staged-for-reversion wins (checked first, the more urgent case)"
         :staged-for-reversion
         (master-checkout-drift-lib/classify-drift
          {:main-content "main" :main-ok? true
           :index-content "staged" :index-ok? true
           :worktree-content "further-edited" :worktree-ok? true}))

;; ── aggregate-verdict ────────────────────────────────────────────────────────

(assert= "all :no-drift -> :no-drift overall"
         :no-drift
         (master-checkout-drift-lib/aggregate-verdict
          {"a.bb" :no-drift "b.bb" :no-drift}))

(assert= "one :uncommitted-edit among clean files -> :drift overall"
         :drift
         (master-checkout-drift-lib/aggregate-verdict
          {"a.bb" :no-drift "b.bb" :uncommitted-edit}))

(assert= "one :staged-for-reversion among clean files -> :drift overall"
         :drift
         (master-checkout-drift-lib/aggregate-verdict
          {"a.bb" :no-drift "b.bb" :staged-for-reversion}))

(assert= ":unknown outranks :drift - one unreadable file is never masked by another file's real drift"
         :unknown
         (master-checkout-drift-lib/aggregate-verdict
          {"a.bb" :staged-for-reversion "b.bb" :unknown}))

(assert= ":unknown outranks a sea of :no-drift - one unreadable file is never masked by everything else reading clean"
         :unknown
         (master-checkout-drift-lib/aggregate-verdict
          {"a.bb" :no-drift "b.bb" :no-drift "c.bb" :unknown}))

(assert= "an empty per-file map is :no-drift (vacuously nothing differs)"
         :no-drift
         (master-checkout-drift-lib/aggregate-verdict {}))

;; ── format-alarm-text ────────────────────────────────────────────────────────

(assert= ":no-drift emits no alarm text at all"
         nil
         (master-checkout-drift-lib/format-alarm-text {:overall :no-drift :per-file {}}))

(let [text (master-checkout-drift-lib/format-alarm-text
            {:overall :drift
             :per-file {"swarmforge/scripts/flow_watchdog_lib.bb" :staged-for-reversion}})]
  (assert-true "a :drift alarm states the running code is not the landed code"
               (clojure.string/includes? text "not the code"))
  (assert-true "a :drift alarm names the drifted file"
               (clojure.string/includes? text "swarmforge/scripts/flow_watchdog_lib.bb"))
  (assert-true "a :drift alarm for a staged difference says which side is which (STAGED)"
               (clojure.string/includes? text "STAGED")))

(let [text (master-checkout-drift-lib/format-alarm-text
            {:overall :drift
             :per-file {"swarmforge/scripts/handoffd.bb" :uncommitted-edit}})]
  (assert-true "a :drift alarm for an uncommitted edit says which side is which (working-tree/uncommitted)"
               (clojure.string/includes? text "uncommitted")))

(let [text (master-checkout-drift-lib/format-alarm-text
            {:overall :unknown :per-file {"swarmforge/scripts/handoffd.bb" :unknown}})]
  (assert-true "an :unknown alarm says it could not determine drift"
               (clojure.string/includes? text "COULD NOT RUN"))
  (assert-true "an :unknown alarm never phrases itself as no-drift/clean"
               (not (clojure.string/includes? (clojure.string/lower-case text) "no drift found")))
  (assert-true "an :unknown alarm explicitly says NOT as no-drift"
               (clojure.string/includes? text "not as no-drift")))

;; ── check-master-checkout-drift! (injected fake IO, no real git) ──────────────

(defn- fake-run-git [git-log responses]
  (fn [_project-root args]
    (swap! git-log conj args)
    (get responses args {:ok? false :content nil})))

(defn- fake-read-disk [contents]
  (fn [_project-root _scripts-subdir bare-name]
    (if (contains? contents bare-name)
      {:ok? true :content (get contents bare-name)}
      {:ok? false :content nil})))

(let [git-log (atom [])
      alarms (atom [])
      responses {["rev-parse" "--verify" "main"] {:ok? true :content "abc123\n"}
                 ["show" "main:swarmforge/scripts/a.bb"] {:ok? true :content "same"}
                 ["show" ":swarmforge/scripts/a.bb"] {:ok? true :content "same"}}
      result (master-checkout-drift-lib/check-master-checkout-drift!
              {:project-root "/fake/root"
               :entrypoints #{"a.bb"}
               :emit-alarm! (fn [text] (swap! alarms conj text))
               :run-git* (fake-run-git git-log responses)
               :read-disk* (fake-read-disk {"a.bb" "same"})})]
  (assert= "clean agreement across the board -> :no-drift" :no-drift (:overall result))
  (assert= "no alarm is emitted on :no-drift" [] @alarms))

(let [alarms (atom [])
      responses {["rev-parse" "--verify" "main"] {:ok? true :content "abc123\n"}
                 ["show" "main:swarmforge/scripts/a.bb"] {:ok? true :content "post-fix"}
                 ["show" ":swarmforge/scripts/a.bb"] {:ok? true :content "pre-fix"}}
      result (master-checkout-drift-lib/check-master-checkout-drift!
              {:project-root "/fake/root"
               :entrypoints #{"a.bb"}
               :emit-alarm! (fn [text] (swap! alarms conj text))
               :run-git* (fake-run-git (atom []) responses)
               :read-disk* (fake-read-disk {"a.bb" "pre-fix"})})]
  (assert= "a staged reversion -> :drift" :drift (:overall result))
  (assert= "exactly one alarm is emitted for a drift result" 1 (count @alarms))
  (assert-true "the emitted alarm names the drifted path"
               (clojure.string/includes? (first @alarms) "swarmforge/scripts/a.bb")))

(let [alarms (atom [])
      responses {["rev-parse" "--verify" "main"] {:ok? false :content nil}}
      result (master-checkout-drift-lib/check-master-checkout-drift!
              {:project-root "/fake/root"
               :entrypoints #{"a.bb"}
               :emit-alarm! (fn [text] (swap! alarms conj text))
               :run-git* (fake-run-git (atom []) responses)
               :read-disk* (fake-read-disk {"a.bb" "whatever"})})]
  (assert= "main unresolvable -> :unknown overall, never :no-drift" :unknown (:overall result))
  (assert= "an alarm IS emitted for :unknown (never silently treated as clean)" 1 (count @alarms))
  (assert-true "the alarm for an unresolvable main says so"
               (clojure.string/includes? (first @alarms) "COULD NOT RUN")))

(let [alarms (atom [])
      responses {["rev-parse" "--verify" "main"] {:ok? true :content "abc123\n"}
                 ["show" "main:swarmforge/scripts/a.bb"] {:ok? true :content "same"}
                 ["show" ":swarmforge/scripts/a.bb"] {:ok? true :content "same"}}
      result (master-checkout-drift-lib/check-master-checkout-drift!
              {:project-root "/fake/root"
               :entrypoints #{"a.bb"}
               :emit-alarm! (fn [text] (swap! alarms conj text))
               :run-git* (fake-run-git (atom []) responses)
               ;; a.bb is unreadable on disk - simulates a permissions/IO failure
               ;; reading the working-tree copy even though main/index resolve fine.
               :read-disk* (fake-read-disk {})})]
  (assert= "an unreadable working-tree file -> :unknown, never masked as :no-drift by a resolvable main/index" :unknown (:overall result))
  (assert= "an alarm is emitted" 1 (count @alarms)))

(if (empty? @failures)
  (println "master_checkout_drift_lib (BL-839): ALL TESTS PASSED")
  (do (println (str "master_checkout_drift_lib (BL-839): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
