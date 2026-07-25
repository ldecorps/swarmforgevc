#!/usr/bin/env bb
;; BL-328: TDD runner for build_freshness_lib.bb's pure functions - no
;; filesystem, no git, no process I/O. Mirrors operator_lib_test_runner.bb.

(ns build-freshness-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "build_freshness_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── stale? ──────────────────────────────────────────────────────────────
(assert-true "per-merged-code-reaches-daemons-01: a running sha behind main is stale"
             (build-freshness-lib/stale? "abc111" "def222"))
(assert-false "per-merged-code-reaches-daemons-06: a running sha matching main is not stale"
              (build-freshness-lib/stale? "abc111" "abc111"))
(assert-false "an unresolvable running sha (nil) is never reported stale - never fabricate"
              (build-freshness-lib/stale? nil "def222"))
(assert-false "an unresolvable running sha (blank string) is never reported stale"
              (build-freshness-lib/stale? "" "def222"))
(assert-false "an unresolvable main sha is never reported stale"
              (build-freshness-lib/stale? "abc111" nil))
(assert-false "both unresolvable is never reported stale"
              (build-freshness-lib/stale? nil nil))

;; ── freshness-entry ─────────────────────────────────────────────────────
(assert= "freshness-entry names both the running and main build for a stale process"
         {:name "bridge" :running_sha "abc111" :main_sha "def222" :stale true}
         (build-freshness-lib/freshness-entry {:name "bridge" :running-sha "abc111"} "def222"))

(assert= "freshness-entry for a fresh process"
         {:name "bridge" :running_sha "abc111" :main_sha "abc111" :stale false}
         (build-freshness-lib/freshness-entry {:name "bridge" :running-sha "abc111"} "abc111"))

(assert= "freshness-entry blanks an empty-string sha to nil, not a false-looking empty string"
         {:name "handoffd" :running_sha nil :main_sha "def222" :stale false}
         (build-freshness-lib/freshness-entry {:name "handoffd" :running-sha ""} "def222"))

;; ── freshness-report / stale-process-names ─────────────────────────────
(assert= "per-merged-code-reaches-daemons-03: every process gets its own entry, whatever language it is"
         [{:name "bridge (compiled)" :running_sha "abc111" :main_sha "def222" :stale true}
          {:name "handoffd (interpreted)" :running_sha "def222" :main_sha "def222" :stale false}]
         (build-freshness-lib/freshness-report
          [{:name "bridge (compiled)" :running-sha "abc111"}
           {:name "handoffd (interpreted)" :running-sha "def222"}]
          "def222"))

(assert= "stale-process-names extracts exactly the stale ones, in order"
         ["bridge" "bot"]
         (build-freshness-lib/stale-process-names
          [{:name "bridge" :running_sha "a" :main_sha "z" :stale true}
           {:name "handoffd" :running_sha "z" :main_sha "z" :stale false}
           {:name "bot" :running_sha "b" :main_sha "z" :stale true}]))

(assert= "stale-process-names is empty when nothing is stale"
         []
         (build-freshness-lib/stale-process-names
          [{:name "bridge" :running_sha "z" :main_sha "z" :stale false}]))

;; ── BL-629: on-deployed-surface? / touches-deployed-surface? ──────────────
(assert-true "on-deployed-surface?: extension/src files are the deployed surface"
             (build-freshness-lib/on-deployed-surface? "extension/src/foo.ts"))
(assert-true "on-deployed-surface?: extension/package.json is the deployed surface"
             (build-freshness-lib/on-deployed-surface? "extension/package.json"))
(assert-true "on-deployed-surface?: extension/package-lock.json is the deployed surface"
             (build-freshness-lib/on-deployed-surface? "extension/package-lock.json"))
(assert-true "on-deployed-surface?: extension/tsconfig* is the deployed surface"
             (build-freshness-lib/on-deployed-surface? "extension/tsconfig.build.json"))
(assert-true "on-deployed-surface?: swarmforge/scripts/ (excluding test/) is the deployed surface"
             (build-freshness-lib/on-deployed-surface? "swarmforge/scripts/build_freshness_cli.bb"))
(assert-false "on-deployed-surface?: swarmforge/scripts/test/ is excluded from the deployed surface"
              (build-freshness-lib/on-deployed-surface? "swarmforge/scripts/test/test_build_freshness_cli.sh"))
(assert-false "on-deployed-surface?: extension/out/ (compiled output) is not the deployed surface"
              (build-freshness-lib/on-deployed-surface? "extension/out/tools/start-bridge-headless.js"))
(assert-false "on-deployed-surface?: bookkeeping paths are not the deployed surface"
              (build-freshness-lib/on-deployed-surface? "backlog/paused/BL-1.yaml"))
(assert-false "touches-deployed-surface?: no changed path on the surface -> false"
              (build-freshness-lib/touches-deployed-surface? ["backlog/paused/BL-1.yaml" "docs/index.md"]))
(assert-true "touches-deployed-surface?: any ONE changed path on the surface -> true"
             (build-freshness-lib/touches-deployed-surface? ["docs/index.md" "extension/src/foo.ts"]))

;; ── code-drift-shas / tip-approval-status ──────────────────────────────────
(assert= "code-drift-shas: empty drift names nothing"
         []
         (build-freshness-lib/code-drift-shas []))
(assert= "code-drift-shas: a bookkeeping-only commit is never named"
         []
         (build-freshness-lib/code-drift-shas [{:sha "bookkeeping1" :touches-surface? false}]))
(assert= "code-drift-shas: a code commit is named, a bookkeeping commit alongside it is not"
         ["code1"]
         (build-freshness-lib/code-drift-shas [{:sha "code1" :touches-surface? true}
                                                {:sha "bookkeeping1" :touches-surface? false}]))
(assert= "code-drift-shas: a merge commit in the drift is named exactly like any other code commit"
         ["merge1"]
         (build-freshness-lib/code-drift-shas [{:sha "merge1" :touches-surface? true}
                                                {:sha "side1" :touches-surface? false}]))

(assert= "tip-approval-status: no offending commits reads approved"
         {:approved? true :offending-shas []}
         (build-freshness-lib/tip-approval-status []))
(assert= "tip-approval-status: a bookkeeping-only commit still reads approved"
         {:approved? true :offending-shas []}
         (build-freshness-lib/tip-approval-status [{:sha "bk1" :touches-surface? false}]))
(assert= "tip-approval-status: a code commit reads not-approved and is named"
         {:approved? false :offending-shas ["code1"]}
         (build-freshness-lib/tip-approval-status [{:sha "code1" :touches-surface? true}
                                                     {:sha "bk1" :touches-surface? false}]))

;; ── sync-gate-decision ──────────────────────────────────────────────────
(assert= "sync-gate-decision: empty drift, no dirty surface, ref present -> proceeds"
         {:refuse? false :reason nil :offending-shas [] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [] :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: bookkeeping-only drift proceeds"
         {:refuse? false :reason nil :offending-shas [] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [{:sha "bk1" :touches-surface? false}]
           :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: code drift refuses and names only the offending sha"
         {:refuse? true :reason :code-drift :offending-shas ["code1"] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true
           :drift-commits [{:sha "code1" :touches-surface? true} {:sha "bk1" :touches-surface? false}]
           :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: a merge commit that touches the surface refuses just like any other code commit"
         {:refuse? true :reason :code-drift :offending-shas ["merge1"] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true
           :drift-commits [{:sha "merge1" :touches-surface? true} {:sha "side1" :touches-surface? false}]
           :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: missing ref fails closed even with empty drift"
         {:refuse? true :reason :missing-ref :offending-shas [] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? false :drift-commits [] :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: a dirty path under the surface refuses and names the path"
         {:refuse? true :reason :dirty-surface :offending-shas [] :offending-paths ["extension/src/foo.ts"] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [] :dirty-surface-paths ["extension/src/foo.ts"] :override? false}))

(assert= "sync-gate-decision: no dirty-surface paths (bookkeeping dirt was already filtered out by the CLI) never refuses"
         {:refuse? false :reason nil :offending-shas [] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [] :dirty-surface-paths [] :override? false}))

(assert= "sync-gate-decision: override proceeds despite code drift and is reported as used"
         {:refuse? false :reason :code-drift :offending-shas ["code1"] :offending-paths [] :override-used? true}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [{:sha "code1" :touches-surface? true}]
           :dirty-surface-paths [] :override? true}))

(assert= "sync-gate-decision: override is never reported as used when nothing would have refused"
         {:refuse? false :reason nil :offending-shas [] :offending-paths [] :override-used? false}
         (build-freshness-lib/sync-gate-decision
          {:qa-ref-exists? true :drift-commits [] :dirty-surface-paths [] :override? true}))

;; ── execute-sync! (adapter-injected, refusal ordering) ────────────────────
;; Mirrors role_lifecycle_lib_test_runner.bb's own spy-adapters convention -
;; this is the ONLY place refusal ordering is proven non-vacuously: a real
;; fixture repo has no stale processes, so "nothing was restarted" there is
;; true whether or not the gate is what suppressed it.
(defn spy-sync-adapters []
  (let [calls (atom [])]
    {:calls calls
     :adapters {:recompile! (fn [] (swap! calls conj [:recompile!]))
                :restart-group! (fn [group] (swap! calls conj [:restart-group! group]))
                :record-override! (fn [gate] (swap! calls conj [:record-override! (:offending-shas gate)]))
                :gather-settled-report (fn [] (swap! calls conj [:gather-settled-report]) [])}}))

(let [{:keys [calls adapters]} (spy-sync-adapters)
      result (build-freshness-lib/execute-sync!
              {:qa-ref-exists? true
               :drift-commits [{:sha "code1" :touches-surface? true}]
               :dirty-surface-paths []
               :override? false
               :processes [{:name "bridge" :group :front-desk :running-sha "old"}]
               :main-sha "new"}
              adapters)]
  (assert-true "execute-sync!: a refusing gate is reported as refused" (:refused result))
  (assert= "execute-sync!: a refusing gate NEVER invokes recompile!/restart-group!/gather-settled-report"
           []
           @calls))

(let [{:keys [calls adapters]} (spy-sync-adapters)
      result (build-freshness-lib/execute-sync!
              {:qa-ref-exists? true
               :drift-commits []
               :dirty-surface-paths []
               :override? false
               :processes [{:name "bridge" :group :front-desk :running-sha "old"}]
               :main-sha "new"}
              adapters)]
  (assert-false "execute-sync!: a non-refusing gate is reported as not refused" (:refused result))
  (assert= "execute-sync!: a non-refusing gate with a stale process recompiles, restarts its group, then gathers the settled report - in that order"
           [[:recompile!] [:restart-group! :front-desk] [:gather-settled-report]]
           @calls))

(let [{:keys [calls adapters]} (spy-sync-adapters)
      result (build-freshness-lib/execute-sync!
              {:qa-ref-exists? true
               :drift-commits [{:sha "code1" :touches-surface? true}]
               :dirty-surface-paths []
               :override? true
               :processes []
               :main-sha "new"}
              adapters)]
  (assert-false "execute-sync!: an overridden refusal proceeds" (:refused result))
  (assert= "execute-sync!: an overridden refusal records the override BEFORE proceeding, even with nothing stale to restart"
           [[:record-override! ["code1"]] [:gather-settled-report]]
           @calls))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "build_freshness_lib: ALL TESTS PASSED"))
